const te = require('@openzeppelin/test-environment')
const { contract, web3 } = te
const { BN } = require('@openzeppelin/test-helpers')
const { expect } = require('chai').use(require('chai-bn')(BN))
const { toBN } = web3.utils
const { priceToBN, PRICE_MULTIPLIER } = require('../common/price')
const BlendToken = contract.fromArtifact('BlendToken')
const Orchestrator = contract.fromArtifact('Orchestrator')
const Registry = contract.fromArtifact('Registry')
const ERC20Stub = contract.fromArtifact('ERC20Stub')


async function testDeploy(accounts, initialSupply) {
    const {
        owner, distributionBackend, registryBackend,
        usdcPool, initialHolder
    } = accounts
    const contracts = {}
    contracts.registry = await Registry.new({ from: owner })
    contracts.blend = await BlendToken.new({ from: owner })
    contracts.usdcToken = await ERC20Stub.new({ from: owner })
    contracts.orchestrator = await Orchestrator.new(
        distributionBackend,
        contracts.blend.address,
        contracts.registry.address,
        usdcPool,
        contracts.usdcToken.address,
        { from: owner }
    )
    const initializeBlend =
        contracts.blend.methods['initialize(address,uint256,address,address)']

    const initializeRegistry =
        contracts.registry.methods['initialize(address,address)']

    const initializeUsdc =
        contracts.usdcToken.methods['initialize(address,uint256)']
    await initializeUsdc(usdcPool, initialSupply.usdc)

    await initializeBlend(
        initialHolder,
        initialSupply.blend,
        contracts.registry.address,
        contracts.orchestrator.address,
        { from: owner }
    )

    await initializeRegistry(
        contracts.blend.address,
        registryBackend,
        { from: owner }
    )

    return contracts
}

function prepareOrder(order) {
    return {
        ...order,
        price: order.price.toString(),
        amount: order.amount.toString()
    }
}

function blendToUsdc(blendAmount, price) {
    return blendAmount.mul(price).div(PRICE_MULTIPLIER)
}

const RunStrategy = Object.freeze({
    ONE_BATCH: 1,
    TWO_BATCHES: 2,
    INDIVIDUAL: 3
})

class Scenario {
    constructor(orders, strategy, contracts, accounts) {
        this.orders = orders
        this.strategy = strategy
        this.contracts = contracts
        this.accounts = accounts
    }

    async prepare() {
        await this.registerTenderAddresses()
        await this.fundBlend()
        await this.lockFunds()
        await this.contracts.usdcToken.approve(
            this.contracts.orchestrator.address,
            this.usdcTotal(),
            {from: this.accounts.usdcPool}
        )
    }

    usdcTotal() {
        return this.orders.reduce((acc, order) => {
            const usdc = blendToUsdc(order.amount, order.price)
            return acc.add(usdc)
        }, toBN('0'))
    }

    async run() {
        await this.contracts.orchestrator.startDistribution(
            {from: this.accounts.distributionBackend}
        )
        const batches = this._splitOrders()
        for (let batch of batches) {
            console.log(batch)
            await this.contracts.orchestrator.executeOrders(
                batch.map(prepareOrder),
                {from: this.accounts.distributionBackend}
            )
        }
        await this.contracts.orchestrator.stopDistribution(
            {from: this.accounts.distributionBackend}
        )
    }

    async registerTenderAddresses() {
        for (let tenderAddress of this.tenderAddresses()) {
            await this.contracts.registry.registerTenderAddress(
                tenderAddress, {from: this.accounts.registryBackend}
            )
        }
    }

    tenderAddresses() {
        return new Set(this.orders.map(o => o.redeemerTenderAddress))
    }

    wallets() {
        return new Set(this.orders.map(o => o.redeemerWallet))
    }

    async fundBlend() {
        // Here we collect `wallet => blendAmount` mapping in order to
        // decrease the number of funding transactions, possibly
        // increasing the tests performance in case of multiple similar
        // transfers.
        const blendAmounts = this.orders.reduce((acc, order) => {
            const wallet = order.redeemerWallet
            acc[wallet] = this._addBNs(
                acc[wallet], order.amount
            )
            return acc
        }, {})

        for (let [addr, amount] of Object.entries(blendAmounts)) {
            await this.contracts.blend.transfer(
                addr, amount, {from: this.accounts.initialHolder}
            )
        }
    }

    async lockFunds() {
        // Here we collect `(wallet, tenderAddress) => lockedAmount` mapping
        // in order to decrease the number of lock transactions, possibly
        // increasing the tests performance in case of multiple similar
        // transactions.
        const locks = this.orders.reduce((acc, order) => {
            const wallet = order.redeemerWallet
            const tenderAddr = order.redeemerTenderAddress
            if (acc[wallet] === undefined) {
                acc[wallet] = {}
            }
            acc[wallet][tenderAddr] = this._addBNs(
                acc[wallet][tenderAddr], order.amount
            )
            return acc
        }, {})

        // We need a Web3 contract and not Truffle contract here because we
        // make a transfer from web3.eth.accounts.wallet, which truffle does
        // not know about
        const blend = new web3.eth.Contract(
            this.contracts.blend.abi,
            this.contracts.blend.address
        )

        for (let [wallet, tenderLocks] of Object.entries(locks)) {
            for (let [tenderAddress, amount] of Object.entries(tenderLocks)) {
                await web3.eth.sendTransaction({
                    from: this.accounts.initialHolder, to: wallet,
                    value: toBN(web3.utils.toWei('0.01'))
                })
                const txData =
                    await blend.methods
                               .transfer(tenderAddress, amount.toString())
                               .encodeABI()
                const txGas =
                    await blend.methods
                            .transfer(tenderAddress, amount.toString())
                            .estimateGas({from: wallet})
                await web3.eth.sendTransaction({
                    from: wallet,
                    to: this.contracts.blend.address,
                    data: txData,
                    gas: txGas,
                    value: '0'
                })
            }
        }
    }

    async balancesSnapshot() {
        const blend = await this._tokenBalancesSnapshot(
            this.contracts.blend, this.tenderAddresses()
        )
        const usdc = await this._tokenBalancesSnapshot(
            this.contracts.usdcToken, this.wallets()
        )
        return {blend, usdc}
    }

    async balancesDelta(prevSnapshot) {
        const blend = await this._tokenBalancesDelta(
            this.contracts.blend, prevSnapshot.blend
        )
        const usdc = await this._tokenBalancesDelta(
            this.contracts.usdcToken, prevSnapshot.usdc
        )
        return {blend, usdc}
    }

    async remainingAllowance() {
        return await this.contracts.usdcToken.allowance(
            this.accounts.usdcPool,
            this.contracts.orchestrator.address
        )
    }

    async _tokenBalancesSnapshot(token, addresses) {
        const balances = {}
        for (let address of addresses) {
            balances[address] = await token.balanceOf(address)
        }
        return balances
    }

    async _tokenBalancesDelta(token, oldBalances) {
        const deltas = {}
        for (let [addr, oldBalance] of Object.entries(oldBalances)) {
            const newBalance = await token.balanceOf(addr)
            deltas[addr] = newBalance.sub(oldBalance)
        }
        return deltas
    }

    _splitOrders() {
        if (this.strategy == RunStrategy.ONE_BATCH) {
            return [this.orders]
        } else if (this.strategy == RunStrategy.TWO_BATCHES) {
            const idx = Math.floor(this.orders.length / 2)
            const first = this.orders.slice(0, idx)
            const second = this.orders.slice(idx)
            return [first, second]
        } else if (this.strategy == RunStrategy.INDIVIDUAL) {
            return this.orders.map(order => [order])
        }
        throw Error('Unknown run strategy')
    }

    _addBNs(a, b) {
        if (a === undefined) return b
        if (b === undefined) return a
        return a.add(b)
    }

}

function deriveAddress(n) {
    if (web3.eth.accounts.wallet.length < n) {
        web3.eth.accounts.wallet.create(10)
    }
    return web3.eth.accounts.wallet[n].address
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}


describe('Distribution', async function() {
    const [
        alice, owner, usdcPool, distributionBackend,
        registryBackend
    ] = te.accounts

    const ctx = {
        accounts: {
            owner, distributionBackend, registryBackend, usdcPool,
            initialHolder: alice,
            deriveWallet: n => deriveAddress(2 * n),
            deriveTenderAddress: n => deriveAddress(2 * n + 1)
        },
        initialSupply: {
            blend: toBN('1000000000000'),
            usdc: toBN('1000000000000')
        }
    }

    describe('tenderAddress-wallet: 1-1, fee: 0', async function() {
        function mkOrder(idx) {
            const priceNum = getRandomInt(1, 100000) / PRICE_MULTIPLIER.toNumber()
            return {
                redeemerTenderAddress: ctx.accounts.deriveTenderAddress(idx),
                redeemerWallet: ctx.accounts.deriveWallet(idx),
                price: priceToBN(priceNum.toString()),
                amount: toBN(getRandomInt(1, 100))
            }
        }

        function mkOrders() {
            const orders = []
            for (let i = 0; i < 10; ++i) {
                orders[i] = mkOrder(i)
            }
            return orders.sort((a, b) => a.price.cmp(b.price))
        }

        async function prepareScenario(runStrategy) {
            const orders = mkOrders()
            const contracts = await testDeploy(ctx.accounts, ctx.initialSupply)
            const scenario = new Scenario(
                orders, runStrategy, contracts, ctx.accounts
            )
            await scenario.prepare()
            const snapshot = await scenario.balancesSnapshot()
            return {scenario, snapshot}
        }

        describe('Executes 10 random orders', async function() {
            async function checkResults({scenario, snapshot}) {
                await scenario.run()
                const balancesDelta = await scenario.balancesDelta(snapshot)

                for (let order of scenario.orders) {
                    expect(
                        balancesDelta.blend[order.redeemerTenderAddress]
                    ).to.be.bignumber.equal(
                        order.amount.neg()
                    )
                    expect(
                        balancesDelta.usdc[order.redeemerWallet]
                    ).to.be.bignumber.equal(
                        blendToUsdc(order.amount, order.price)
                    )
                }

                expect(
                    await scenario.remainingAllowance()
                ).to.be.bignumber.equal(
                    toBN('0')
                )
            }

            it('in one batch', async function() {
                await testProperty(
                    () => prepareScenario(RunStrategy.ONE_BATCH),
                    checkResults
                )
            })

            it('in two batches', async function() {
                await testProperty(
                    () => prepareScenario(RunStrategy.TWO_BATCHES),
                    checkResults
                )
            })

            it('in 10 batches', async function() {
                await testProperty(
                    () => prepareScenario(RunStrategy.INDIVIDUAL),
                    checkResults
                )
            })
        })

        it('Skips a non-tender address', async function() {
            await testProperty(
                () => prepareScenario(RunStrategy.ONE_BATCH),
                async ({scenario, snapshot}) => {

                    const nontenderIdx =
                        getRandomInt(0, scenario.orders.length - 1)

                    // Set to a non-tender address, get expected BLND
                    // and USDC difference and fix the snapshot
                    const nontenderAddress = ctx.accounts.registryBackend
                    scenario.orders[nontenderIdx].redeemerTenderAddress =
                        nontenderAddress
                    const skippedOrder = scenario.orders[nontenderIdx]
                    const nontenderBlendAmount = skippedOrder.amount
                    const undistributedUsdc = blendToUsdc(
                        skippedOrder.amount, skippedOrder.price
                    )
                    snapshot.blend[nontenderAddress] = toBN('0')

                    await scenario.run()
                    const balancesDelta = await scenario.balancesDelta(snapshot)

                    for (let i = 0; i < scenario.orders.length; ++i) {
                        const order = scenario.orders[i]
                        if (i == nontenderIdx) {
                            expect(
                                balancesDelta.blend[order.redeemerTenderAddress]
                            ).to.be.bignumber.equal(toBN('0'))
                            expect(
                                balancesDelta.usdc[order.redeemerWallet]
                            ).to.be.bignumber.equal(toBN('0'))
                            continue
                        }
                        expect(
                            balancesDelta.blend[order.redeemerTenderAddress]
                        ).to.be.bignumber.equal(
                            order.amount.neg()
                        )
                        expect(
                            balancesDelta.usdc[order.redeemerWallet]
                        ).to.be.bignumber.equal(
                            blendToUsdc(order.amount, order.price)
                        )
                    }

                    expect(
                        await scenario.remainingAllowance()
                    ).to.be.bignumber.equal(
                        undistributedUsdc
                    )
                }
            )
        })

        it('Partially executes underfunded orders', async function() {
            await testProperty(
                () => prepareScenario(RunStrategy.ONE_BATCH),
                async ({scenario, snapshot}) => {
                    // Here we simply add some big amount to orders. Since
                    // tender balance does not change, we successfully simulate
                    // an underfunding situation. We remember the balance of the
                    // tender address, though, to check whether the order has
                    // been executed successfully.
                    for (let order of scenario.orders) {
                        order.partialAmount =
                            snapshot.blend[order.redeemerTenderAddress]
                        order.amount = order.amount.add(toBN('100000000'))
                    }

                    await scenario.run()
                    const balancesDelta = await scenario.balancesDelta(snapshot)

                    for (let order of scenario.orders) {
                        expect(
                            balancesDelta.blend[order.redeemerTenderAddress]
                        ).to.be.bignumber.equal(
                            order.partialAmount.neg()
                        )
                        expect(
                            balancesDelta.usdc[order.redeemerWallet]
                        ).to.be.bignumber.equal(
                            blendToUsdc(order.partialAmount, order.price)
                        )
                    }

                    expect(
                        await scenario.remainingAllowance()
                    ).to.be.bignumber.equal(
                        toBN('0')
                    )
                }
            )
        })
    })
})

async function testProperty(generator, test) {
    for (let i = 0; i < 10; i++) {
        const value = await generator()
        await test(value)
    }
}
