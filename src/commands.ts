import * as deploy from './commands/deploy'
import * as info from './commands/info'
import * as merge from './commands/merge'
import * as prepareTx from './commands/prepareTx'
import * as sign from './commands/sign'
import * as submit from './commands/submit'
import * as upgrade from './commands/upgrade'

import * as deploySwap from './commands/swap/deploySwap'
import * as swapLock from './commands/swap/lock'
import * as swapGenerate from './commands/swap/generate'
import * as swapRevealHash from './commands/swap/revealHash'
import * as swapRedeem from './commands/swap/redeem'
import * as swapClaimRefund from './commands/swap/claimRefund'

export {
    deploy, info, merge, prepareTx, sign, submit, upgrade,
    deploySwap, swapGenerate, swapLock, swapRevealHash,
    swapRedeem, swapClaimRefund
}
