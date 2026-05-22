// SPDX-License-Identifier: MIT
// NOT AUDITED. Reference implementation only; not for production. See contract NatSpec banner.
pragma solidity ^0.8.25;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title IERC5643
/// @notice Subscription NFT extension to ERC-721. https://eips.ethereum.org/EIPS/eip-5643
interface IERC5643 {
    event SubscriptionUpdate(uint256 indexed tokenId, uint64 expiration);

    function renewSubscription(uint256 tokenId, uint64 duration) external payable;
    function cancelSubscription(uint256 tokenId) external payable;
    function expiresAt(uint256 tokenId) external view returns (uint64);
    function isRenewable(uint256 tokenId) external view returns (bool);
}

/// @title SubscriptionNFT
/// @notice ERC-721 + ERC-5643 subscription collection compatible with the
///         `SubscriptionPredicate` tool gating used by this example. Soulbound,
///         one token per owner, with mutable per-token tier and expiration.
///
/// ============================================================================
/// REFERENCE IMPLEMENTATION ONLY. NOT FOR PRODUCTION USE.
///
/// This contract is shipped as a worked example to show how a subscription NFT
/// can satisfy the on-chain interface that `SubscriptionPredicate` expects
/// (`tokenOfOwner`, `tierOf`, `expiresAt`). It deliberately omits production
/// concerns: no audit, no payment flow, no admin role separation, no upgrade
/// path, no token metadata, no renewal economics, no allowlist or rate limiting.
/// Treat it as a starting point to fork and harden, not a drop-in dependency.
/// ============================================================================
///
/// @dev Designed for testing two-tier gating (e.g. Basic = 1, Pro = 2).
///      - Owner-only minting and renewal (no payment plumbing).
///      - Tier is mutable in place via `setTier`.
///      - Token ID 0 is reserved as the "no token" sentinel and is never minted.
///      - Transfers revert; mint and burn are the only owner transitions.
contract SubscriptionNFT is ERC721, Ownable, IERC5643 {
    uint256 private _nextTokenId = 1;

    mapping(address account => uint256 tokenId) private _ownedToken;
    mapping(uint256 tokenId => uint64 timestamp) private _expiration;
    mapping(uint256 tokenId => uint8 level) private _tier;

    error Soulbound();
    error AlreadySubscribed(address account, uint256 existingTokenId);
    error InvalidTier();
    error NonexistentToken(uint256 tokenId);
    error NotTokenOwnerOrAdmin(uint256 tokenId, address caller);
    error RefundFailed(address recipient, uint256 amount);

    constructor(string memory name_, string memory symbol_, address initialOwner)
        ERC721(name_, symbol_)
        Ownable(initialOwner)
    {}

    // -----------------------------------------------------------------------
    //  Predicate-facing views (see SubscriptionPredicate.ISubscriptionNFT)
    // -----------------------------------------------------------------------

    /// @notice Returns the token ID held by `account`, or 0 if none.
    function tokenOfOwner(address account) external view returns (uint256) {
        return _ownedToken[account];
    }

    /// @notice Returns the tier of `tokenId` (1-based).
    function tierOf(uint256 tokenId) external view returns (uint8) {
        if (_ownerOf(tokenId) == address(0)) revert NonexistentToken(tokenId);
        return _tier[tokenId];
    }

    /// @inheritdoc IERC5643
    function expiresAt(uint256 tokenId) external view returns (uint64) {
        if (_ownerOf(tokenId) == address(0)) revert NonexistentToken(tokenId);
        return _expiration[tokenId];
    }

    /// @inheritdoc IERC5643
    function isRenewable(uint256 tokenId) external view returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }

    // -----------------------------------------------------------------------
    //  Owner operations
    // -----------------------------------------------------------------------

    /// @notice Mint a subscription token for `to` with the given tier and duration.
    /// @param to       Recipient. Must not already hold a token.
    /// @param tier_    Tier level (must be >= 1).
    /// @param duration Subscription length in seconds, added to `block.timestamp`.
    function mint(address to, uint8 tier_, uint64 duration) external onlyOwner returns (uint256 tokenId) {
        if (tier_ == 0) revert InvalidTier();
        uint256 existing = _ownedToken[to];
        if (existing != 0) revert AlreadySubscribed(to, existing);

        tokenId = _nextTokenId++;
        _tier[tokenId] = tier_;
        uint64 expiration = uint64(block.timestamp) + duration;
        _expiration[tokenId] = expiration;
        // Emit before `_safeMint` so a re-entrant `onERC721Received` callback
        // that burns the token cannot leave a misleading SubscriptionUpdate
        // event ordered after the implicit Transfer-to-zero.
        emit SubscriptionUpdate(tokenId, expiration);
        _safeMint(to, tokenId);
    }

    /// @notice Change the tier of an existing token. Useful for flipping a
    ///         single test wallet between tiers to exercise both gate paths.
    function setTier(uint256 tokenId, uint8 newTier) external onlyOwner {
        if (newTier == 0) revert InvalidTier();
        if (_ownerOf(tokenId) == address(0)) revert NonexistentToken(tokenId);
        _tier[tokenId] = newTier;
    }

    // -----------------------------------------------------------------------
    //  ERC-5643
    // -----------------------------------------------------------------------

    /// @notice Extend a subscription by `duration` seconds. Marked `payable`
    ///         to match the EIP-5643 signature; this contract takes no
    ///         payment, so any attached ETH is refunded to the caller.
    /// @dev Renewing an expired token sets the new expiration relative to
    ///      `block.timestamp`. Renewing an active token extends from the
    ///      current expiration.
    function renewSubscription(uint256 tokenId, uint64 duration) external payable onlyOwner {
        if (_ownerOf(tokenId) == address(0)) revert NonexistentToken(tokenId);
        uint64 current = _expiration[tokenId];
        uint64 base = current > block.timestamp ? current : uint64(block.timestamp);
        uint64 newExpiration = base + duration;
        _expiration[tokenId] = newExpiration;
        emit SubscriptionUpdate(tokenId, newExpiration);
        _refundIfAny();
    }

    /// @notice Cancel a subscription by burning the token. Callable by the
    ///         token holder or the contract owner. `payable` matches the
    ///         EIP-5643 signature; any attached ETH is refunded to the caller.
    function cancelSubscription(uint256 tokenId) external payable {
        address tokenOwner = _ownerOf(tokenId);
        if (tokenOwner == address(0)) revert NonexistentToken(tokenId);
        if (msg.sender != tokenOwner && msg.sender != owner()) {
            revert NotTokenOwnerOrAdmin(tokenId, msg.sender);
        }
        _burn(tokenId);
        emit SubscriptionUpdate(tokenId, 0);
        _refundIfAny();
    }

    /// @dev Refund any ETH attached to a payable call. The contract has no
    ///      treasury; the `payable` keyword exists solely for EIP-5643
    ///      interface compatibility. Called after all state changes so a
    ///      re-entrant caller observes a fully settled token state.
    function _refundIfAny() private {
        uint256 value = msg.value;
        if (value == 0) return;
        (bool ok,) = msg.sender.call{value: value}("");
        if (!ok) revert RefundFailed(msg.sender, value);
    }

    // -----------------------------------------------------------------------
    //  Soulbound enforcement + per-owner index
    // -----------------------------------------------------------------------

    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = super._update(to, tokenId, auth);
        // Allow mint (from == 0) and burn (to == 0); reject everything else.
        if (from != address(0) && to != address(0)) revert Soulbound();
        if (from != address(0)) {
            delete _ownedToken[from];
            delete _expiration[tokenId];
            delete _tier[tokenId];
        }
        if (to != address(0)) {
            _ownedToken[to] = tokenId;
        }
    }

    // -----------------------------------------------------------------------
    //  ERC-165
    // -----------------------------------------------------------------------

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(IERC5643).interfaceId || super.supportsInterface(interfaceId);
    }
}
