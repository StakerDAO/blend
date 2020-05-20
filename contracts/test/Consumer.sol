pragma solidity 0.5.13;

contract Consumer {
    bytes11 public lastFixedBytes;
    bytes public lastVarBytes;
    uint104 public lastUint;
    string public lastString;
    uint public lastDataSize;

    function updateData(
        bytes11 fb,
        bytes memory vb,
        uint104 ui,
        string memory str
    ) public {
        lastFixedBytes = fb;
        lastVarBytes = vb;
        lastUint = ui;
        lastString = str;
        lastDataSize = msg.data.length;
    }

}
