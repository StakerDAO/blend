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
      - if `registry.isTenderAddress(to)`, ensure that `registry.getWallet(to) == sender`
   - **Access:** anyone
   - **Exceptions:**
      - Not enough tokens
      - Transfer to a tender address associated with a different wallet
2. `transferFrom(address from, address to, uint256 amount) -> bool`
   - **Behavior:**
      - transfers tokens (possibly to a tender address)
      - if `registry.isTenderAddress(to)`, ensure that `registry.getWallet(to) == from`
   - **Access:** anyone
   - **Exceptions:**
      - Not enough tokens
      - Not enough allowance
      - Transfer to a tender address associated with a different wallet
3. `lockup(uint256 amount)`
   - **Behavior:**
      - transfers tokens to the tender address, i.e. to `registry.getTenderAddress(sender)`
   - **Access:** anyone
   - **Exceptions:**
      - Not enough tokens to lock
4. `unlock(uint256 amount)`:
   - **Behavior:**
      - IF there are enough tokens on `registry.getTenderAddress(sender)` balance,
      - AND the current phase does not prohibit unlocks,
      - THEN transfeer `amount` of tokens from `registry.getTenderAddress(sender)` to `sender`.
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
      - THEN burns `amount` of tokens from `tenderAddress`.
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
* `mapping (address => address) _tenderAddresses` – wallet to tender address relation
* `mapping (address => address) _holders` – tender address to wallet relation
* `address registryBackend`

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
3. `getTenderAddress(address holder) -> address`
   - **Behavior:** Returns the tender address associated with the particular wallet.
   - **Access:** anyone
   - **Exceptions:**
      - Holder does not have a registered tender address
4. `getWallet(address tenderAddress) -> address`
   - **Behavior:** Returns the wallet associated with the tender address.
   - **Access:** anyone
   - **Exceptions:**
      - Tender address is not registered
5. `registerTenderAddress(address holder, address tenderAddress)`
   - **Behavior:**
      - IF `tenderAddress` is not a key in `_holders`,
      - AND `holder` is not a key in `_tenderAddresses`
      - THEN:
        1. `_holders[tenderAddress] = holder`
        2. `_tenderAddresses[holder] = tenderAddress`
   - **Access:** only **Registry backend**
   - **Exceptions:**
      - Tender address is already registered
      - Holder already has a tender address
      - Unauthorized

## Orchestrator
The contract is upgradeable.

The contract has an owner. The owner can be updated via a two-step updating approach (`setOwner` + `acceptOwnership`).

Types:
```cpp
struct Order {
    address redeemerTenderAddress;
    uint256 price;
    uint256 amount;
}
```

Storage:
* `public address usdc`
* `public address blend`
* `public address registry`
* `public address distributionBackend`

Methods:
1. `setDistributionBackend(address newBackend)`
   - **Behavior:**
      - `distributionBackend = newBackend`
   - **Access:** only **owner**
   - **Exceptions:**
      - Unauthorized
2. `startDistribution()`
   - **Behavior:**
      - `blend.startDistributionPhase()`
   - **Access:** only **Distribution backend**
   - **Exceptions:**
      - Unauthorized
3. `stopDistribution()`
   - **Behavior:**
      - `blend.stopDistributionPhase()`
   - **Access:** only **Distribution backend**
   - **Exceptions:**
      - Unauthorized
4. `executeOrders(Order[] orders)`
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

5. (internal) `_executeOrder(Order order)`
   - **Behavior:**
      - Adjust amounts based on funds left:
         - If there are enough funds to execute the order in full:
            - `usdcAmount = order.amount * order.price`
            - `blendAmount = order.amount`
         - If the order can only be executed partially because there is not enough USDC or USDC allowance:
            - `usdcAmount = min(<usdc left>, <allowance left>)`
            - `blendAmount = ceiling(usdcAmount / order.price)`
         - If the order can only be executed partially because there is not enough BLND, fail (because this should never happen).
      - `usdc.transferFrom(usdcPool, registry.getWallet(order.redeemerTenderAddress), usdcAmount)`
      - `blend.burn(order.redeemerTenderAddress, blendAmount)`
   - **Access:** internal
   - **Exceptions:**
      - Tender address is not registered
      - Not enough USDC (or USDC allowance)
      - Not enough BLND
