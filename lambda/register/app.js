const jwt = require("jsonwebtoken");
const AWS = require("aws-sdk");
const https = require("https");
var jwkToPem = require('jwk-to-pem');
const log = require('lambda-log-json');

const ddb = new AWS.DynamoDB.DocumentClient({
  apiVersion: "2012-08-10",
  region: process.env.AWS_REGION
});
const { TABLE_NAME, DEBUG } = process.env;
// let endpoint, event
// // if (DEBUG) {
// endpoint = "jhdk924ki7.execute-api.us-east-1.amazonaws.com/Prod/"
// } else {
//   endpoint = event.requestContext.domainName + "/" + event.requestContext.stage
// }

// const apigwManagementApi = new AWS.ApiGatewayManagementApi({
//   apiVersion: "2018-11-29",
//   endpoint: endpoint
// });

async function httpGet(url, callback, jwtToken) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      res.setEncoding("utf8");
      let body = "";
      res.on("data", data => {
        body += data;
      });
      res.on("end", () => {
        body = JSON.parse(body);
        resolve(body)
      });
    });
  })
}

async function getConnId(uuid) {
  var params = {
    KeyConditionExpression: 'PartitionKey = :uuid AND begins_with(SortKey, :role)',
    ExpressionAttributeValues: {
      ':uuid': `uuid:${uuid}`,
      ':role': "role"
    },
    TableName: TABLE_NAME
  };

  results = await ddb
    .query(params)
    .promise();
  // log.info("AdminID: ", results.Items)
  return results.Items[0]
}

async function getHistory(uuid) {
  var params = {
    TableName: TABLE_NAME,
    FilterExpression: "begins_with(SortKey, :msg)",

    ExpressionAttributeValues: {
      ":msg": "msg:",
    }
  };
  // let params = {
  //   KeyConditionExpression: 'PartitionKey = :role AND begins_with ( SortKey , :connid )',
  //   ExpressionAttributeValues: {
  //     ':role': "role:ADMIN",
  //     ':connid': "cid"
  //   },
  //   TableName: TABLE_NAME
  // };
  connId = await getConnId('admin')
  log.info(connId.cid)
  results = await ddb
    .scan(params)
    .promise();
  //log.info("AdminID: ", results.Items[0].cid)

  for (i = 0; i < results.Items.length; i++) {
    payload = results.Items[i].message
    log.info(payload)
    apigwManagementApi
      .postToConnection({ ConnectionId: connId.cid, Data: JSON.stringify(payload) })
      .promise();
  }
}
async function sendMessages(payload) {

}
async function validateJwt(token) {
  test = jwt.decode(token, { complete: true })
  log.info(test)
  jwtKeys = await httpGet(`${test.payload.iss}/.well-known/jwks.json`)
  //log.info(jwtKeys)

  signingKey = jwtKeys.keys.find(key => key.kid === test.header.kid)
  log.info("signingKey", signingKey)
  var pem = jwkToPem(signingKey);
  log.info(pem)
  validate = jwt.verify(token, pem, { algorithms: ['RS256'] })
  return validate

}

async function writeToDdb(uuid, role, cid) {
  return ddb.put({
    TableName: process.env.TABLE_NAME,
    Item: {
      PartitionKey: `uuid:${uuid}`,
      SortKey: `role:${role}`,
      cid: cid,
      uuid: uuid
    }
  }).promise()
}

exports.handler = async event => {
  let connectionData;
  let item;
  let adminData
  let items = []


  try {
    // log.info(event)
    const decodedToken = jwt.decode(JSON.parse(event.body).token, { complete: true });
    //log.info("decoded Token ", decodedToken)
    token = JSON.parse(event.body).token
    log.info("Validated Token: ", await validateJwt(token))
    // log.info("Admin Registration Detected: ", decodedToken)
    log.info("success")
    // await writeToDdb("admin", "admin", event.requestContext.connectionId)
    await ddb.put({
      TableName: process.env.TABLE_NAME,
      Item: {
        PartitionKey: `uuid:admin`,
        SortKey: `role:admin`,
        cid: event.requestContext.connectionId,
        uuid: `${decodedToken.payload.sub}`
      }
    }).promise()
    await ddb.put({
      TableName: process.env.TABLE_NAME,
      Item: {
        PartitionKey: `uuid:${decodedToken.payload.sub}`,
        SortKey: `role:admin`,
        cid: event.requestContext.connectionId,
      }
    }).promise()
  } catch (err) {
    log.info(err)
    log.info("fail")
    data = JSON.parse(event.body)
    // log.info(data)
    await ddb.put({
      TableName: process.env.TABLE_NAME,
      Item: {
        PartitionKey: `uuid:${data.userdata.uuid}`,
        name: data.userdata.name,
        cid: event.requestContext.connectionId,
        SortKey: `role:user`,
      }
    }).promise()

  }
  return { statusCode: 200, body: "Connected." };
};

