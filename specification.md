# StakerDAO Blend Architecture

## Blend Token
The contract is an upgradeable ERC-20 token with custom `transfer` and `transferFrom` logic.

The contract has an owner. The owner can be updated via a two-step updating approach (`setOwner` + `acceptOwnership`).

Storage:
* `public address orhestrator`
* `public address registry`

Methods:
1. `transfer(address to, unit256 amount) -> bool`
   - **Behavior:**
      - transfers tokens (possibly to a tender address)
      - if `registry.isTenderAddress(to)`, then `registry.recordTransfer(sender, to, amount)`
   - **Access:** anyone
   - **Exceptions:**
      - Not enough tokens
2. `transferFrom(address from, address to, uint256 amount) -> bool`
   - **Behavior:**
      - transfers tokens (possibly to a tender address)
      - if `registry.isTenderAddress(to)`, then `registry.recordTransfer(from, to, amount)`
   - **Access:** anyone
   - **Exceptions:**
      - Not enough tokens
      - Not enough allowance
3. `unlock(address tenderAddress, uint256 amount)`:
   - **Behavior:**
      - IF `amount <= registry.getLockedAmount(tenderAddress, sender)`,
      - AND `amount <= balanceOf(tenderAddress)`
      - AND the current phase does not prohibit unlocks,
      - THEN:
         - transfer `amount` of tokens from `tenderAddress` to `sender`
         - `registry.recordUnlock(tenderAddress, sender, amount)`
   - **Access:** anyone
   - **Exceptions:**
      - Unlocks are prohibited
      - Not enough tokens to unlock
5. `startDistributionPhase()`
   - **Behavior:**
      - Disallow unlocks
      - Allow burnouts
      - Do nothing if already at distribution phase
   - **Access:** only `orhestrator`
   - **Exceptions:**
      - Unauthorized
6. `stopDistributionPhase()`
   - **Behavior:**
      - Allow unlocks
      - Disallow burnouts
      - Do nothing if already at regular phase
   - **Access:** only `orhestrator`
   - **Exceptions:**
      - Unauthorized
7. `burn(address tenderAddress, uint256 amount)`
   - **Behavior:**
      - IF at the distribution phase,
      - AND the address is a registered tender address (i.e. `registry.isTenderAddress(tenderAddress) == true`)
      - AND there are enough tokens to burn
      - THEN burns `amount` of tokens from `tenderAddress`
   - **Access:** only `orhestrator`
   - **Exceptions:**
      - Burning tokens is prohibited at this stage
      - Not enough tokens to burn
      - Unauthorized
8. `setRegistry(address newRegistry)`
   - **Behavior:**
      - `registry = newRegistry`
   - **Access:** only **owner**
   - **Exceptions:**
      - Unauthorized
9. `setOrchestrator(address newOrchestrator)`
   - **Behavior:**
      - `orchestrator = newOrchestrator`
   - **Access:** only **owner**
   - **Exceptions:**
      - Unauthorized

## Registry

The contract is upgradeable.

The contract has an owner. The owner can be updated via a two-step updating approach (`setOwner` + `acceptOwnership`).

Storage:
* `mapping (address => bool) private _tenderAddresses` – whether some address is a registered tender address
* `mapping (address => mapping (address => uint256)) private _balances` – tenderAddress to source wallet to balance relation
* `address public registryBackend`
* `address public blend`

Methods:
1. `setRegistryBackend(address newBackend)`
   - **Behavior:**
      - `registryBackend = newBackend`
   - **Access:** only **owner**
   - **Exceptions:**
      - Unauthorized
2. `isTenderAddress(address tenderAddress) -> bool`
   - **Behavior:** Returns whether `tenderAddress` is a registered tender address.
   - **Access:** anyone
   - **Exceptions:** none
3. `getLockedAmount(tenderAddress, wallet) -> uint256`
   - **Behavior:** Returns `_balances[tenderAddress][wallet]`.
   - **Access:** anyone
   - **Exceptions:** none
3. `recordTransfer(address from, address tenderAddress, uint256 amount)`
   - **Behavior:**
      - `_balances[tenderAddress][from] += amount` (with SafeMath)
   - **Access:** only `blend`
   - **Exceptions:**
      - Tender address is not registered
      - Overflow
      - Unauthorized
4. `recordUnlock(address tenderAddress, address to, uint256 amount)`
   - **Behavior:**
      - IF `_balances[tenderAddress][to] >= amount`
      - THEN `_balances[tenderAddress][to] -= amount` (with SafeMath)
      - ELSE fail with not enough balance
   - **Access:** only `blend`
   - **Exceptions:**
      - Tender address is not registered
      - Not enough balance
      - Underflow
      - Unauthorized
5. `registerTenderAddress(address tenderAddress)`
   - **Behavior:**
      - IF `_tenderAddresses[tenderAddress] == false`
      - THEN: `_tenderAddresses[tenderAddress] = true`
      - ELSE: fail with Tender address is already registered
   - **Access:** only **Registry backend**
   - **Exceptions:**
      - Tender address is already registered
      - Unauthorized

## Orchestrator
The contract is **not** upgradeable.

The contract has an owner. The owner can be updated via a two-step updating approach (`setOwner` + `acceptOwnership`).

Types:
```cpp
struct Order {
    address redeemerTenderAddress;
    address redeemerWallet;
    uint256 price;
    uint256 amount;
}
```

Storage:
* `public address usdc`
* `public address blend`
* `public address registry`
* `public address distributionBackend`
* `public address usdcPool`

Methods:
1. `setDistributionBackend(address newBackend)`
   - **Behavior:**
      - `distributionBackend = newBackend`
   - **Access:** only **owner**
   - **Exceptions:**
      - Unauthorized
2. `setUsdcPool(address pool)`
   - **Behavior:**
      - `_usdcPool = pool`
   - **Access:** only **owner**
   - **Exceptions:**
      - Unauthorized
3. `startDistribution()`
   - **Behavior:**
      - `blend.startDistributionPhase()`
   - **Access:** only **Distribution backend**
   - **Exceptions:**
      - Unauthorized
4. `stopDistribution()`
   - **Behavior:**
      - `blend.stopDistributionPhase()`
   - **Access:** only **Distribution backend**
   - **Exceptions:**
      - Unauthorized
5. `executeOrders(Order[] orders)`
   - **Behavior:**
      - Sort orders from low to high price
      - WHILE
         - there are orders remaining
         - AND there is some USDC left
         - AND there is some USDC allowance left
      - DO `_executeOrder(Order order)` with error logging
   - **Access:** only **Distribution backend**
   - **Exceptions:**
      - Unauthorized
6. (internal) `_executeOrder(Order order)`
   - **Behavior:**
      - IF `registry.isTenderAddress(order.redeemerTenderAddress) == false` THEN fail
      - Adjust amounts based on funds left:
         - If there are enough funds to execute the order in full:
            - `usdcAmount = order.amount * order.price`
            - `blendAmount = order.amount`
         - If the order can only be executed partially because there is not enough USDC or USDC allowance:
            - `usdcAmount = min(<usdc left>, <allowance left>)`
            - `blendAmount = ceiling(usdcAmount / order.price)`
         - If the order can only be executed partially because there is not enough BLND:
            - `blendAmount = <blend left>`
            - `usdcAmount = blendAmount * order.price`
      - `usdc.transferFrom(_usdcPool, order.redeemerWallet, usdcAmount)`
      - `blend.burn(order.redeemerTenderAddress, blendAmount)`
   - **Access:** internal
   - **Exceptions:**
      - Tender address is not registered
