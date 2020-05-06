const te = require('@openzeppelin/test-environment')
const { contract, web3 } = te
const { BN, expectRevert } = require('@openzeppelin/test-helpers')
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

// We need a this helper function because we make a transfer from
// web3.eth.accounts.wallet. It has no funds initially and truffle
// does not know about it, so in this function we fund the account
// and then send the tx using web3.eth.sendTransaction function.
// We don't use web3.eth.Contract because currently it does not
// support in-memory wallets, that's why all this dark magic.
async function lockTokens(blend, ethSource, wallet, tenderAddress, amount) {
    await web3.eth.sendTransaction({
        from: ethSource, to: wallet,
        value: toBN(web3.utils.toWei('0.01'))
    })
    const txData =
        await blend.contract.methods
                    .transfer(tenderAddress, amount.toString())
                    .encodeABI()
    const txGas =
        await blend.contract.methods
                .transfer(tenderAddress, amount.toString())
                .estimateGas({from: wallet})
    await web3.eth.sendTransaction({
        from: wallet,
        to: blend.address,
        data: txData,
        gas: txGas,
        value: '0'
    })
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

        for (let [wallet, tenderLocks] of Object.entries(locks)) {
            for (let [tenderAddress, amount] of Object.entries(tenderLocks)) {
                await lockTokens(
                    this.contracts.blend,
                    this.accounts.initialHolder,
                    wallet,
                    tenderAddress,
                    amount
                )
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

    describe('Fee & burn dispatching', async function() {
        const [alice, bob, carol] = [1, 2, 3].map(
            idx => ctx.accounts.deriveWallet(idx)
        )
        const tenderAddress = ctx.accounts.deriveTenderAddress(0)

        const orders = (() => {
            const redeemerTenderAddress = tenderAddress
            const redeemerWallet = ctx.accounts.deriveWallet(0)
            return [
                {
                    redeemerTenderAddress,
                    redeemerWallet,
                    price: priceToBN('1'),
                    amount: toBN('10')
                },
                {
                    redeemerTenderAddress,
                    redeemerWallet,
                    price: priceToBN('1.5'),
                    amount: toBN('6')
                },
            ]
        })()

        function $(address, amount) {
            return {address, amount: toBN(amount)}
        }

        async function fund(amounts) {
            for (let {address, amount} of amounts) {
                await ctx.contracts.blend.transfer(
                    address, amount, {from: ctx.accounts.initialHolder}
                )
                await lockTokens(
                    ctx.contracts.blend,
                    ctx.accounts.initialHolder,
                    address,
                    tenderAddress,
                    amount
                )
            }
        }

        async function expectTenderBalances(amounts) {
            for (let {address, amount} of amounts) {
                const lockedAmount =
                    await ctx.contracts.registry.getLockedAmount(
                        tenderAddress, address
                    )
                expect(lockedAmount).to.be.bignumber.equal(amount)
            }
        }

        async function expectRemainingSenders(senders) {
            const actual = []
            const sendersCount =
                await ctx.contracts.registry.getSendersCount(tenderAddress)
            expect(sendersCount).to.be.bignumber.equal(toBN(senders.length))
            for (let i = 0; i < senders.length; ++i) {
                actual.push(
                    await ctx.contracts.registry.getSender(tenderAddress, i)
                )
            }
            expect(actual).to.deep.equal(senders)
        }

        beforeEach(async function() {
            ctx.contracts = await testDeploy(ctx.accounts, ctx.initialSupply)
            await ctx.contracts.registry.registerTenderAddress(
                tenderAddress, {from: ctx.accounts.registryBackend}
            )
            await ctx.contracts.registry.setFeePerAddress(
                toBN('1'), {from: ctx.accounts.registryBackend}
            )
            await ctx.contracts.usdcToken.approve(
                ctx.contracts.orchestrator.address,
                toBN('100000000'),
                {from: ctx.accounts.usdcPool}
            )
        })

        async function checkFee({tx, receipt}, expectedFee) {
            // We need to collect the events manually because `expectEvent`
            // can't sum up the values, and we deduce fees several times
            // (once per each order)
            const events = await ctx.contracts.registry.getPastEvents(
                'BurnDispatched',
                {
                    fromBlock: receipt.blockNumber,
                    toBlock: receipt.blockNumber,
                    filter: {tenderAddress}
                }
            )
            const totalFee =
                    events.filter(e => e.transactionHash == tx)
                          .reduce((acc, e) => acc.add(e.args.fee), toBN('0'))
            expect(totalFee).to.be.bignumber.equal(toBN(expectedFee))
        }

        async function runScenario(params) {
            await fund(params.before)
            await ctx.contracts.orchestrator.startDistribution(
                {from: ctx.accounts.distributionBackend}
            )
            if (params.expectedError) {
                await expectRevert(
                    ctx.contracts.orchestrator.executeOrders(
                        orders.map(prepareOrder),
                        {from: ctx.accounts.distributionBackend}
                    ),
                    params.expectedError
                )
                return
            }
            const {after, expectedFee} = params
            const receipt = await ctx.contracts.orchestrator.executeOrders(
                orders.map(prepareOrder),
                {from: ctx.accounts.distributionBackend}
            )

            await checkFee(receipt, expectedFee)
            await expectRemainingSenders(after.map(v => v.address))
            await expectTenderBalances(after)
            await ctx.contracts.orchestrator.stopDistribution(
                {from: ctx.accounts.distributionBackend}
            )
        }

        it('Burns from the first address', async function() {
            await runScenario({
                before: [$(alice, '10'), $(bob, '10'), $(carol, '20')],
                after: [$(alice, '10'), $(bob, '10'), $(carol, '4')],
                expectedFee: '0'
            })
        })

        it('Liquidates the first address', async function() {
            await runScenario({
                before: [$(alice, '10'), $(bob, '10'), $(carol, '11')],
                after: [$(alice, '10'), $(bob, '4')],
                expectedFee: '1'
            })
        })

        it('Liquidates the first address (splits the order correctly)',
            async function() {
                await runScenario({
                    before: [$(alice, '10'), $(bob, '10'), $(carol, '10')],
                    after: [$(alice, '10'), $(bob, '3')],
                    expectedFee: '1'
                })
            }
        )

        it('Liquidates the first two addresses', async function() {
            await runScenario({
                before: [$(alice, '10'), $(bob, '6'), $(carol, '6')],
                after: [$(alice, '4')],
                expectedFee: '2'
            })
        })

        it('Liquidates all three addresses', async function() {
            await runScenario({
                before: [$(alice, '11'), $(bob, '4'), $(carol, '4')],
                after: [],
                expectedFee: '3'
            })
        })

        it('Fails if not enough balance', async function() {
            await runScenario({
                before: [$(alice, '5'), $(bob, '2'), $(carol, '3')],
                expectedError: "Not enough balance on tender address"
            })
        })

        it('Fails if not enough balance (2)', async function() {
            await runScenario({
                before: [$(alice, '10'), $(bob, '4'), $(carol, '4')],
                expectedError: "Not enough balance on tender address"
            })
        })

        it('Liquidates the first address even if only fee is deduced',
           async function() {
                await runScenario({
                    before: [$(alice, '11'), $(bob, '11'), $(carol, '1')],
                    after: [$(alice, '5')],
                    expectedFee: '2'
                })
           }
        )

        it('Liquidates the second address even if only fee is deduced',
           async function() {
                await runScenario({
                    before: [$(alice, '11'), $(bob, '1'), $(carol, '11')],
                    after: [$(alice, '5')],
                    expectedFee: '2'
                })
           }
        )
    })

    describe('Randomized, tenderAddress-wallet: 1-1, fee: 0', async function() {
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
            return {scenario}
        }

        describe('Executes 10 random orders', async function() {
            async function checkResults({scenario}) {
                const snapshot = await scenario.balancesSnapshot()
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

        it('Fails if there is a non-tender address', async function() {
            await testProperty(
                () => prepareScenario(RunStrategy.ONE_BATCH),
                async ({scenario}) => {
                    const nontenderIdx =
                        getRandomInt(0, scenario.orders.length - 1)

                    const nontenderAddress = ctx.accounts.registryBackend
                    const nontenderOrder = scenario.orders[nontenderIdx]
                    scenario.orders[nontenderIdx].redeemerTenderAddress =
                        nontenderAddress
                    await ctx.contracts.blend.transfer(
                        nontenderAddress, nontenderOrder.amount,
                        {from: scenario.accounts.initialHolder}
                    )

                    await expectRevert(
                        scenario.run(),
                        'Burning from regular addresses is not allowed'
                    )
                }
            )
        })

        it('Fails if there is an underfunded order', async function() {
            await testProperty(
                () => prepareScenario(RunStrategy.ONE_BATCH),
                async ({scenario}) => {
                    const underfundedIdx =
                        getRandomInt(0, scenario.orders.length - 1)
                    scenario.orders[underfundedIdx].amount =
                        scenario.orders[underfundedIdx].amount.add(toBN('1'))

                    // Need to approve more USDC because we have changed
                    // the amount of one of the orders. If we don't do this
                    // and this order happens to be the last one, it will
                    // be executed partially due to the lack of USDC, and
                    // we'll not get the expected error.
                    await scenario.contracts.usdcToken.approve(
                        scenario.contracts.orchestrator.address,
                        scenario.usdcTotal(),
                        {from: scenario.accounts.usdcPool}
                    )

                    await expectRevert(
                        scenario.run(),
                        'Not enough balance on tender address'
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
