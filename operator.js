const { Api, JsonRpc } = require('eosjs');
const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig');
const { TextDecoder, TextEncoder } = require('util');
const fs = require('fs');

const rpc = new JsonRpc('https://wax.eosdac.io'); 

// LOAD WALLETS FROM wallets.csv
const wallets = [];
const allFileContents = fs.readFileSync('wallets.csv', 'utf-8');
allFileContents.split(/\r?\n/).forEach(line => {
    let splits = line.split(",");
    wallets.push({
        "address": splits[0],
        "key": splits[1],
        "used": false
    });
});
console.log(`Loaded ${wallets.length} wallets.`);

async function doTransaction(wallet)  {
    const signatureProvider = new JsSignatureProvider([wallet.key]);
    const api = new Api({ rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });
    try {
        const result = await api.transact({
            actions: [
                {
                    "account": "play.mars",
                    "authorization": [
                        {
                          "actor": wallet.address,
                          "permission": "active"
                        }
                    ],
                    "data": {
                      "runner": wallet.address
                    },
                    "name": "run"
                }
            ]
        }, {
            blocksBehind: 3,
            expireSeconds: 30,
        });
        return {"success": true, "tx": result.transaction_id};
    } catch (e) {
        return {"success": false, "error": e.message};
    }
}
async function checkTX(tx) {
    let checkTX = await rpc.history_get_transaction(tx);
    if (checkTX.hasOwnProperty('id')) {
        return true;
    } else {
        return false;
    }
}
async function getWaitSeconds(address) {
    try {
        let lastRun = await rpc.get_table_rows({
            "json": true,
            "code": "play.mars",
            "scope": "play.mars",
            "table": "operaccs",
            "lower_bound": address,
            "upper_bound": address,
            "index_position": 1,
            "key_type": "",
            "limit": 1,
            "reverse": false,
            "show_payer": false
        });
        let now = Math.floor(Date.now() / 1000);
        let waitSeconds = (lastRun.rows[0].last_used_at + 60 * 15) - now;
        return waitSeconds;
    } catch (e) {
        return false;
    }
}

async function work() {
    while (true) {
        for (const [index, value] of wallets.entries()) {
            if (value.used) {
                continue;
            }
            let txResponse = await doTransaction(value);
            if (txResponse.success) {
                await new Promise(r => setTimeout(r, 5000));
                let checkTXResponse = await checkTX(txResponse.tx);
                if (checkTXResponse) {
                    console.log(`[${value.address}][SUCCESS] txResponse: ${txResponse}`);
                    wallets[index].used = true;
                    setTimeout(async () => {
                        let checkTX = await rpc.history_get_transaction(txResponse.tx);
                        if (checkTX.hasOwnProperty('id')) {
                            console.log(`[${value.address}][SUCCESS] checkTX: ${checkTX}`);
                            setTimeout(() => { wallets[index].used = false; }, 15 * 60 * 1000);
                        } else {
                            console.log(`[${value.address}][ERROR] checkTX: not found`);
                            wallets[index].used = false;
                        }
                    }, 5 * 1000);
                }
            }
            if (!txResponse.success) {
                if (/CPU|max-transaction-time|max_cpu_usage_ms/.test(txResponse.error)) {
                    // console.log(`[${value.address}][ERROR] txResponse: CPU or transaction time`);
                } else if (txResponse.error.includes("Please wait")) {
                    wallets[index].used = true;

                    let waitSeconds = await getWaitSeconds(value.address);
                    console.log(`[${value.address}][ERROR] txResponse: Wallet already used, sleep ${waitSeconds}`);
                    setTimeout(() => { wallets[index].used = false; }, waitSeconds * 1000);
                } else {
                    console.log(`[${value.address}][ERROR][OTHER] txResponse:`);
                    console.dir(txResponse);
                }
            }
        }
        await new Promise(r => setTimeout(r, 1000));
    }
}

work();