const web3 = require('web3')
const { toBN } = web3.utils


PRICE_MULTIPLIER = toBN('10000')
PRICE_DECIMALS = 4

function priceToBN(priceStr) {
    const [integer, fractional] = priceStr.split('.')
    if (fractional && fractional.length > PRICE_DECIMALS) {
        throw new Error('Too many decimals in price, refuse to lose precision')
    }
    integerBN = toBN(integer)
    fractionalBN = fractional ? toBN(fractional) : toBN('0')
    return integerBN.mul(PRICE_MULTIPLIER).add(fractionalBN)
}

module.exports = {
    PRICE_MULTIPLIER, PRICE_DECIMALS, priceToBN
}
