import {
  Page,
  Text,
  Spacer,
  Link,
  Loading,
  Table,
  Input,
  Checkbox,
  Textarea,
  Dot,
  Tooltip,
} from "@zeit-ui/react";

import { ethers } from "ethers";
import { Provider as MulticallProvider, Provider } from "ethers-multicall";
import { default as abiDecoder } from "abi-decoder";
import { useState, useEffect } from "react";

import moment from "moment";
import masterchefAbi from "./masterchef-abi.json";
import timelockAbi from "./timelock-abi.json";
import gnosisSafeAbi from "./gnosis-safe-abi.json";

const executingAddress = "0x2bF3cC8Fa6F067cc1741c7467C8Ee9F00e837757";
const timelockAddresses = [
  "0xAFa2c40DF28768eaB8aDD6f2572B32A7F8c86a5E",
].map((x) => x.toLowerCase());
const timelockNames = {
  "0xafa2c40df28768eab8add6f2572b32a7f8c86a5e": "24 hour Timelock",
};
const etherscanProvider = new ethers.providers.EtherscanProvider(
  1,
  "5V1DUNJRCKDD6WDZKEAQZDI2SZ5Z6IAQFJ"
);
const infuraProvider = new ethers.providers.InfuraProvider(1);

const multicallProvider = new MulticallProvider(infuraProvider);

// Timelock contract
abiDecoder.addABI(timelockAbi);
abiDecoder.addABI(masterchefAbi);
abiDecoder.addABI(gnosisSafeAbi);

// Transactions to help decode
// queueTransaction, cancelTransaction, executeTransaction
const specialFunctionNames = [
  "queueTransaction",
  "cancelTransaction",
  "executeTransaction",
];

// Addresses
const TARGET_ADDRESS_NAMES = {
  "0xdb9daa0a50b33e4fe9d0ac16a1df1d335f96595e": "Masterchef",
  "0x0309c98b1bffa350bcb3f9fb9780970ca32a5060": "BDPI",
};

const Main = () => {
  const [history, setHistory] = useState([]);
  const [showRawTarget, setShowRawTarget] = useState(false);
  const [showRawData, setShowRawData] = useState(false);
  const [functionSignatureFilter, setFunctionSignatureFilter] = useState("");
  const [txTypeFilter, setTxTypeFilter] = useState("");

  const getHistory = async () => {
    await multicallProvider.init();

    // Don't want first tx, as that is contract data
    const h = await etherscanProvider.getHistory(executingAddress);
    const newest = h.reverse();

    const now = new Date().getTime();

    const decoded = newest
      .map(({ data, from, blockNumber, timestamp, hash }) => {
        const tx = abiDecoder.decodeMethod(data);

        const to = tx.params[0].value.toLowerCase();

        // Only pay attention to timelock contract
        if (!timelockAddresses.includes(to)) {
          return null;
        }

        // 2 is the data
        const decodedFunction = abiDecoder.decodeMethod(tx.params[2].value);

        if (specialFunctionNames.includes(decodedFunction.name)) {
          // target, value, signature, data, eta
          const signature = decodedFunction.params[2].value;
          const data = decodedFunction.params[3].value;

          const functionParams = signature
            .split("(")[1]
            .split(")")[0]
            .split(",");

          const decodedData = ethers.utils.defaultAbiCoder.decode(
            functionParams,
            data
          );

          decodedFunction.params[3].value =
            "[" + decodedData.map((x) => x.toString()).join(", ") + "]";

          decodedFunction.params[3].rawValue = data;
        }

        // ETA in human reable format
        decodedFunction.params = decodedFunction.params.map((x) => {
          if (x.name === "eta") {
            const t = parseInt(x.value) * 1000;
            const formattedTime = moment(t).from(now);

            return {
              ...x,
              value: `${x.value} (${formattedTime})`,
            };
          }

          return x;
        });

        // Target as a link
        const rawTarget = decodedFunction.params[0].value;
        let target = rawTarget.toLowerCase();

        if (TARGET_ADDRESS_NAMES[target]) {
          target = (
            <Link color href={`https://etherscan.io/address/${rawTarget}`}>
              {TARGET_ADDRESS_NAMES[target]}
            </Link>
          );
        }

        return {
          hash,
          decodedFunctionRaw: JSON.stringify(
            decodedFunction.params.map((x) => {
              return { k: x.name, v: x.value };
            })
          ),
          txTypeRaw: decodedFunction.name,
          txType: (
            <Link color href={`https://etherscan.io/tx/${hash}`}>
              {decodedFunction.name}
            </Link>
          ),
          to: (
            <Link color href={`https://etherscan.io/address/${to}`}>
              {timelockNames[to]}
            </Link>
          ),
          timestamp: moment(timestamp * 1000).from(Date.now()),
          rawTarget,
          target,
          value: (
            <Textarea
              minHeight="1"
              width="100%"
              value={decodedFunction.params[1].value}
            ></Textarea>
          ),
          signature: decodedFunction.params[2].value,
          data: (
            <Textarea
              minHeight="3"
              width="100%"
              value={decodedFunction.params[3].value}
            ></Textarea>
          ),
          rawData: (
            <Textarea
              minHeight="3"
              width="100%"
              value={decodedFunction.params[3].rawValue}
            ></Textarea>
          ),
          eta: decodedFunction.params[4].value,
        };
      })
      .filter((x) => x !== null);

    // Key: decodedFunctionRaw, Value: Hash
    const nonqueuedTransactionKV = decoded
      .filter((x) => x.txTypeRaw.toLowerCase() !== "queuetransaction")
      .reduce((acc, x) => {
        // Order matters here as the transactions are sorted descending via timestamp
        // So if we have 2 execute tx's w/ the same params,
        // the latest one will be the successful one.
        return {
          [x.decodedFunctionRaw]: x.hash,
          ...acc,
        };
      }, {});

    const executedTransactions = decoded
      .filter((x) => x.txTypeRaw.toLowerCase() === "executetransaction")
      .map((x) => x.decodedFunctionRaw);

    const cancelledTransactions = decoded
      .filter((x) => x.txTypeRaw.toLowerCase() === "canceltransaction")
      .map((x) => x.decodedFunctionRaw);

    const decodedWithContext = decoded.map((x) => {
      if (x.txTypeRaw.toLowerCase() === "queuetransaction") {
        if (cancelledTransactions.includes(x.decodedFunctionRaw)) {
          return {
            queue: (
              <Tooltip
                text={
                  <Link
                    color
                    href={`https://etherscan.io/tx/${
                      nonqueuedTransactionKV[x.decodedFunctionRaw]
                    }`}
                  >
                    Cancelled
                  </Link>
                }
              >
                <Dot></Dot>
              </Tooltip>
            ),
            ...x,
          };
        }
        if (executedTransactions.includes(x.decodedFunctionRaw)) {
          return {
            queue: (
              <Tooltip
                text={
                  <Link
                    color
                    href={`https://etherscan.io/tx/${
                      nonqueuedTransactionKV[x.decodedFunctionRaw]
                    }`}
                  >
                    Executed
                  </Link>
                }
              >
                <Dot type="success"></Dot>
              </Tooltip>
            ),
            ...x,
          };
        }

        return {
          queue: (
            <Tooltip text="Queued">
              <Dot type="warning"></Dot>
            </Tooltip>
          ),
          ...x,
        };
      }

      return { ...x };
    });

    setHistory(
      decodedWithContext.map((x, i) => {
        return { index: i, ...x };
      })
    );
  };

  useEffect(() => {
    if (history.length > 0) return;

    try {
      getHistory();
    } catch (e) {
      console.log("ERROR");
    }
  }, []);

  return (
    <Page
      size="large"
      style={{
        minWidth: "100vw",
        height: "100vh",
        overflow: "scroll",
        whiteSpace: "nowrap",
      }}
    >
      <Text h2>BasketDAO Timelock Transactions</Text>
      <Text type="secondary">
        Only last 10,000 transactions displayed. The transactions are executed
        from a{" "}
        <Link color href={`https://etherscan.io/address/${executingAddress}`}>
          multisig wallet
        </Link>
        , which is why it isn't showing up on the{" "}
        <Link
          color
          href={`https://etherscan.io/address/${timelockAddresses[0]}`}
        >
          timelock contract
        </Link>
        .
      </Text>
      <Spacer y={0.33} />
      {history.length === 0 && <Loading>Loading</Loading>}
      {history.length > 0 && (
        <Table
          style={{
            textAlign: "left",
          }}
          data={history
            .map((x) => {
              let y = x;
              if (showRawData) {
                y = { ...y, data: x.rawData };
              }

              if (showRawTarget) {
                y = { ...y, target: x.rawTarget };
              }

              return y;
            })
            .filter((x) => {
              let passed = true;
              if (functionSignatureFilter !== "") {
                passed = x.signature
                  .toLowerCase()
                  .includes(functionSignatureFilter.toLowerCase());
              }

              if (txTypeFilter !== "") {
                passed =
                  passed &&
                  x.txTypeRaw
                    .toLowerCase()
                    .includes(txTypeFilter.toLowerCase());
              }

              return passed;
            })}
        >
          <Table.Column prop="queue" label="queue" />
          <Table.Column
            prop="txType"
            label={
              (
                <>
                  TX TYPE&nbsp;&nbsp;
                  <Input
                    size="mini"
                    width="120px"
                    status="secondary"
                    onChange={(e) => {
                      setTxTypeFilter(e.target.value);
                    }}
                    value={txTypeFilter}
                    placeholder="FILTER TX TYPE"
                  />
                </>
              ) as any
            }
          />
          <Table.Column prop="to" label="to" />
          <Table.Column prop="timestamp" label="timestamp" />
          <Table.Column
            prop="target"
            label={
              (
                <>
                  target&nbsp;&nbsp;
                  <Checkbox
                    checked={showRawTarget}
                    onChange={(e) => {
                      setShowRawTarget(!showRawTarget);
                    }}
                    size="mini"
                  >
                    show raw
                  </Checkbox>
                </>
              ) as any
            }
          />
          <Table.Column prop="value" label="value" />
          <Table.Column
            prop="signature"
            label={
              (
                <>
                  signature&nbsp;&nbsp;
                  <Input
                    size="mini"
                    width="100px"
                    status="secondary"
                    onChange={(e) => {
                      setFunctionSignatureFilter(e.target.value);
                    }}
                    value={functionSignatureFilter}
                    placeholder="FILTER SIG"
                  />
                </>
              ) as any
            }
          />
          <Table.Column
            prop="data"
            label={
              (
                <>
                  data&nbsp;&nbsp;
                  <Checkbox
                    checked={showRawData}
                    onChange={(e) => {
                      setShowRawData(!showRawData);
                    }}
                    size="mini"
                  >
                    show raw
                  </Checkbox>
                </>
              ) as any
            }
          />
          <Table.Column prop="eta" label="eta" />
        </Table>
      )}
    </Page>
  );
};

export default Main;
