const web3 = require('web3')
const { toBN } = web3.utils


PRICE_MULTIPLIER = toBN('10000')
PRICE_DECIMALS = 4

function priceToBN(priceStr) {
    const [integer, fractional] = priceStr.split('.')
    if (fractional && fractional.length > PRICE_DECIMALS) {
        throw new Error('Too many decimals in price, refuse to lose precision')
    }

    const integerBN = toBN(integer)
    let fractionalBN = toBN('0')
    if (fractional) {
        const zeros = '0'.repeat(PRICE_DECIMALS - fractional.length)
        fractionalBN = toBN(fractional + zeros)
    }
    return integerBN.mul(PRICE_MULTIPLIER).add(fractionalBN)
}

module.exports = {
    PRICE_MULTIPLIER, PRICE_DECIMALS, priceToBN
}
