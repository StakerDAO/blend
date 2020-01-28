const LedgerWalletProvider = require("@ledgerhq/web3-subprovider");
const createLedgerSubprovider = LedgerWalletProvider.default
const TransportU2F = require('@ledgerhq/hw-transport-u2f')
const ProviderEngine = require('web3-provider-engine')
const RpcSubprovider = require('web3-provider-engine/subproviders/rpc')


function getLedgerProvider(rpcUrl) {
    const engine = new ProviderEngine()
    const getTransport = () => TransportU2F.create()
    const ledger = createLedgerSubprovider(getTransport, {
        accountsLength: 5
    })
    engine.addProvider(ledger)
    engine.addProvider(new RpcSubprovider({ rpcUrl }))
    engine.start()
    return engine
}

module.exports = { getLedgerProvider }
