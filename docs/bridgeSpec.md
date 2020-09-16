# Protocol description

Parties:

- Alice holds `αBLND` on chain `α`. She is the initiator of the deal, and she is the one who generates the secret.
- Bob holds `βBLND` on chain `β`. He is the second party, he gets the secret from the chain.

Protocol constants:

- `Δ` – negotiation timeout – time for parties to agree on the swap parameters and deploy contracts.
- `T` – timeout, after which Bob can unlock his funds (excluding `Δ`)
- `2T` – timeout, after which Alice can unlock her funds (excluding `Δ`)
- `MAX_SECRET_LENGTH` – the maximum length of the secret

### I. Negotiation

1. Alice generates some `secret` – a byte string of no more than `MAX_SECRET_LENGTH` bytes. `MAX_SECRET_LENGTH` is a protocol constant defined so that gas exhaustion attacks are not possible.
2. Alice sends the following data to Bob (off-chain):
    - Alice's address on chain `β`
    - Amount
    - SHA-256 hash of the secret

3. Bob sends the following data to Alice (off-chain):
    - Bob's address on chain `α`

The messages MUST be properly authenticated. Encryption is NOT required, this data may be considered open.

### II. Initiation

1. Bob locks `N βBLND` on a swap contract `B` on chain `β`, setting:
    - Alice's address on chain `β`
    - `B.releaseTime = NOW + Δ + T`
    - Amount

    Bob does not send the secret hash to the contract yet – he waits until Alice locks her funds too.

2. Alice locks `N αBLND` on a swap contract `A` on chain `α`, setting:
    - Bob's address on chain `α`
    - `A.releaseTime = B.releaseTime + T`
    - Amount
    - Secret hash
3. Bob sends the secret hash to the contract `B`.

### III. Validation phase

1. Alice checks that:
    - `B` is a legitimate Blend swap contract on chain `β`
    - `B.releaseTime` is at least `NOW + T`
    - `B.amount == A.amount`
    - `B.secretHash == A.secretHash`
    - `B.to` is Alice's address on chain `β`
2. Bob checks that:
    - `A` is a legitimate Blend swap contract on chain `α`
    - `A.releaseTime` is at least `B.releaseTime + T`
    - `A.amount == B.amount`
    - `A.secretHash == B.secretHash`
    - `A.to` is ~~Alice's~~ Bob's address on chain `α`

### IV (a). Swap – happy scenario

1. Alice calls `B.redeem(...)`, revealing the secret. The swap contract `B` checks that:
    - the secret is shorter than `MAX_SECRET_LENGTH`;
    - `sha256(secret)` is equal to `secretHash`;
    - the funds for this deal have not been paid out yet.

    If all of the checks pass, the contract sends `N βBLND` to `[B.to](http://b.to)` – Alice's address on chain `β`.

2. Bob learns the secret from Alice's transaction on `β`. He makes a similar call to the swap contract `A` on chain `α`. The swap contract `A` performs the same checks as in (1).

### IV (b). Failed swap, refunds

1. If the deal fails to complete due to any reason after by the time `B.releaseTime`, Bob (or, actually, anyone) can call `B.claimRefund(...)`. The contract checks whether:
    - the current time is indeed greater than `B.releaseTime`;
    - the funds for this deal have not been paid out yet.

    If the preconditions hold true, the `N βBLND` are returned to Bob.

2. If the deal fails to complete due to any reason after by the time `A.releaseTime`, Alice (or, actually, anyone) can call `A.claimRefund(...)`. The contract checks whether:
    - the current time is indeed greater than `A.releaseTime`;
    - the funds for this deal have not been paid out yet.

    If the preconditions hold true, the `N βBLND` are returned to Alice.

---

# Off-chain communication

```
-- A message that Alice sends to Bob
data InitiatorMessage = MkInitiatorMessage
   { βAlice :: βAddress    -- Alice's address on chain β
   , amount :: Natural     -- Swap amount
   , secretHash :: ByteString
   }
```

```
-- A message that Bob sends to Alice
data ParticipantMessage = MkParticipantMessage
   { αBob :: αAddress  -- Bob's address on chain α
   }
```

## Storage

```jsx
mapping (bytes32 => Swap) public swaps;
mapping (bytes32 => bytes) public hashlocks;
mapping (bytes32 => bytes) public secrets;
mapping (bytes32 => Status) public status;

struct Swap {
    address from;
    address to;
    uint amount;
    uint releaseTime;
}

enum Status {
    NOT_INITIALIZED,
    INITIALIZED,
    HASH_REVEALED,
    SECRET_REVEALED,
    REFUNDED
}
```

## Methods

1. `lock(bytes32 lockId, address to, uint256 amount, uint releaseTime, bytes32 secretHash) public`
    - Preconditions:
        - `status[lockId] == NOT_INITIALIZED`
    - Behavior:
        - Fills in the swap:

            ```jsx
            swaps[lockId] = Swap(
                from = msg.sender,
                to = to,
                amount = amount,
                releaseTime = releaseTime
            );
            ```

        - If `secretHash` is non-empty, sets:
            - `status = HASH_REVEALED`
            - `hashlocks[lockId] = secretHash`

            Otherwise, sets `status = INITIALIZED`

        - Transfers `amount` of tokens from `msg.sender` to `address(this)`. In case this fails with an error, the transaction must revert.
    - Errors:
        - Swap with this `lockId` already exists
        - Could not transfer tokens (incufficient balance or allowance)
2. `revealSecretHash(bytes32 lockId, bytes32 secretHash) public` 
    - Preconditions:
        - `status[lockId] == INITIALIZED`
        - `msg.sender == swaps[lockId].from`
    - Behavior:
        - Sets `status[lockId] = HASH_REVEALED`
        - Sets `hashlocks[lockId] = secretHash`
    - Errors:
        - Wrong status
        - Sender is not the initiator
3. `redeem(bytes32 lockId, bytes32 secret) public`
    - Preconditions:
        - `status[lockId] == HASH_REVEALED`
        - `sha256(secret) == hashlocks[lockId]`
    - Behavior:
        - Sets `status[lockId] = SECRET_REVEALED`
        - Sets `secrets[lockId] = secret`
        - Transfers the `swaps[lockId].amount` of tokens from `address(this)` to `swaps[lockId].to`.
    - Errors:
        - Secret is invalid
        - Hash is not set or swap is over
4. `claimRefund(bytes32 lockId) public`
    - Preconditions:
        - `block.timestamp` is greater than or equal to the `swaps[lockId].releaseTime`.
        - `status[lockId]` is either `INITIALIZED` or `HASH_REVEALED`.
    - Behavior:
        - Sets `status[id]` to `REFUNDED`,
        - Transfers the `swaps[lockId].amount` of tokens from `address(this)` to `swaps[lockId].from`. (Note that we do not require `msg.sender` to be equal to the `from` address)
    - Errors:
        - Funds are still locked
        - Swap is over

