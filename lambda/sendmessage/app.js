/*
Message Structure: 
{
  src: {
    userdata{ 
      connId: xxxx
      uuid: xxxxxx-xxxxxx-xxxxxx
      name: {
        first: "xxx"
        last: "xxx"
      }
    }
  }
  dest: {
    userdata{ 
      connId: xxxx
      uuid: xxxxxx-xxxxxx-xxxxxx
    }
  }
  data: {
    text: "data data data"
  }
}

*/
const AWS = require("aws-sdk");

const DEBUG = process.env.AWS_REGION
const { TABLE_NAME } = process.env;

const ddb = new AWS.DynamoDB.DocumentClient({
  apiVersion: "2012-08-10",
  region: process.env.AWS_REGION
});

endpoint = "jhdk924ki7.execute-api.us-east-1.amazonaws.com/Prod/"
const apigwManagementApi = new AWS.ApiGatewayManagementApi({
  apiVersion: "2018-11-29",
  endpoint: endpoint,
});

async function storeMessage(uuid, message, ts) {
  const putParams = {
    TableName: process.env.TABLE_NAME,
    Item: {
      PartitionKey: `uuid:${uuid}`,
      message: message,
      SortKey: `msg:${ts}`,
    }
  };
  return ddb.put(putParams).promise();
}

function getConnId(uuid) {
  var params = {
    KeyConditionExpression: 'PartitionKey = :uuid AND begins_with(SortKey, :role)',
    ExpressionAttributeValues: {
      ':uuid': `uuid:${uuid}`,
      ':role': "role"
    },
    TableName: TABLE_NAME
  };
  return ddb
    .query(params)
    .promise();

}
let cache = {}

exports.handler = async event => {
  const timestamp = new Date().toISOString();
  const payload = JSON.parse(event.body).payload;
  console.log(payload)
  payload.ts = timestamp
  payload.src.connId = event.requestContext.connectionId
  cache[payload.src.userdata.uuid] = event.requestContext.connectionId
  const uuid = payload.dest.userdata.uuid
  try {
    if (uuid in cache) {
      console.log("CACHE HIT")
      console.log(payload)
      await wsSend(cache[uuid], payload)
    } else {
      console.log("CACHE MISS")
      const ddbRes = await getConnId(uuid)
      console.log("ddbRes: ", ddbRes)
      await wsSend(ddbRes.Items[0].cid, payload)
    }
  } catch (err) {
    console.log(err)
    console.log("CACHE STALE")
    ddbRes = await getConnId(uuid)
    await wsSend(ddbRes.Items[0].cid, payload)
  }
  return { statusCode: 200, body: "Data sent." };
};

async function wsSend(destCid, payload) {
  cache[payload.dest.userdata.uuid] = destCid
  return apigwManagementApi
    .postToConnection({ ConnectionId: destCid, Data: JSON.stringify(payload) })
    .promise()
}