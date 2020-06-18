const HDWalletProvider = require('@truffle/hdwallet-provider');
const { getLedgerProvider } = require('./src/providers/ledger')

function env(variable) {
  const value = process.env[variable]
  if (value === undefined) {
    throw new Error(`${variable} environment variable is not defined`)
  }
  return value
}

function infuraUrl(network) {
  const projectId = env('INFURA_PROJECT_ID')
  return `https://${network}.infura.io/v3/${projectId}`
}

module.exports = {
  networks: {
   development: {
      host: "127.0.0.1",     // Localhost (default: none)
      port: 8545,            // Standard Ethereum port (default: none)
      network_id: "*",       // Any network (default: none)
    },

    goerli: {
      provider: () => new HDWalletProvider(env('DEV_MNEMONIC'), infuraUrl('goerli')),
      network_id: 5,
      gas: 8000000,
      gasPrice: 2000000000,  // 2 gwei
    },
  },

  compilers: {
    solc: {
      version: "0.5.13",
      settings: {
        optimizer: {
          enabled: true,
          runs: 200
        },
        evmVersion: "petersburg"
      }
    }
  }
}
