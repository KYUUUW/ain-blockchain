#! /usr/bin/node
/**
 * Copyright 2017, Google, Inc.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

// Require process, so we can mock environment variables
const process = require('process');
const PORT = process.env.PORT || 8080;
const {METHOD, FORGE_RATE} = require("../config")


// Initiate logging
const LOG = process.env.LOG || false;
if(LOG){
  var fs = require('fs');
  var util = require('util');
  var log_dir = __dirname + '/' + ".logs"
  if (!(fs.existsSync(log_dir))){
    fs.mkdirSync(log_dir);
}
  var log_file = fs.createWriteStream(log_dir + '/' + PORT +'debug.log', {flags : 'w'});
  var log_stdout = process.stdout;

  console.log = function(d) { 
    log_file.write(util.format(d) + '\n');
    log_stdout.write(util.format(d) + '\n');
  }
}


// [START gae_flex_mysql_app]
const express = require('express');
// const crypto = require('crypto');
// var Promise = require("bluebird");
// var bodyParser = require('body-parser')
const P2pServer = require('./p2p-server')
const Database = require('../db')
// Define peer2peer server here which will broadcast changes in the database
// and also track which servers are in the network

// Applictation dependencies
const Blockchain = require('../blockchain');
const TransactionPool = require('../db/transaction-pool')
const Miner = require('./miner')
const InvalidPerissonsError = require("../errors")
const Validator = require('./validator') 


const app = express();

app.use(express.json()); // support json encoded bodies
// app.use(bodyParser.urlencoded({ extended: false })); // support encoded bodies

const bc = new Blockchain(String(PORT));
const db = Database.getDatabase(bc)
const tp = new TransactionPool()
const val = new Validator(db)
const p2pServer = new P2pServer(db, bc, tp, val)
const miner = new Miner(bc, tp, p2pServer)

app.get('/', (req, res, next) => {
  try{
    res
      .status(200)
      .set('Content-Type', 'text/plain')
      .send('Welcome to afan-tx-server')
      .end();
    } catch (error){
      console.log(error)
    }
})

app.get('/transactions', (req, res) => {
  try{
    res.json(tp.transactions)
  } catch (error){
    console.log(error)
  }
})

app.get('/blocks', (req, res) => {
  try{
    res.json(bc.chain);
  } catch (error){
    console.log(error)
  }
});

app.get('/mine-transactions', (req, res) => {
  try{
    const block = miner.mine()
    console.log(`New block added: ${block.toString()}`)
    res.redirect('/blocks')
  } catch (error){
    console.log(error)
  }
})


app.get('/stake', (req, res, next) => {
  var statusCode = 201
  var result = null

  try{
    result = db.stake(Number(req.query.ref))
    console.log(`Successfully staked ${req.query.ref}`)
    let transaction = db.createTransaction({type: "SET", ref: ["stakes", db.publicKey].join("/"), value: Number(req.query.ref)}, tp)
    p2pServer.broadcastTransaction(transaction)
  } catch (error){
    if(error instanceof InvalidPerissonsError){
      statusCode = 401
    } else {
      statusCode = 400
    }
    console.log(error.stack)
  }
  res
  .status(statusCode)
  .set('Content-Type', 'application/json')
  .send({code: result ? 0 : -1, result})
  .end();
})


app.get('/get', (req, res, next) => {
  var statusCode = 200
  var result = null
  try{
    result = db.get(req.query.ref)
  } catch (error){
    if(error instanceof InvalidPerissonsError){
      statusCode = 401
    } else {
      statusCode = 400
    }
    console.log(error.stack)
  }
  res
  .status(statusCode)
  .set('Content-Type', 'application/json')
  .send({code: result ? 0 : -1, result})
  .end();
})

app.post('/set', (req, res, next) => {
  var statusCode = 201
  try{
    var ref = req.body.ref;
    var value = req.body.value
    db.set(ref, value)
    let transaction = db.createTransaction({type: "SET", ref, value}, tp)
    p2pServer.broadcastTransaction(transaction)
  } catch (error){
    if(error instanceof InvalidPerissonsError){
      statusCode = 401
    } else {
      statusCode = 400
    }
    console.log(error.stack)
  }
  res.status(statusCode).set('Content-Type', 'application/json').send({code: statusCode < 299? 0: 1}).end();
})

app.post('/increase', (req, res, next) => {
  var statusCode = 201
  try{
    var diff = req.body.diff;
    var result = db.increase(diff)

    let transaction = db.createTransaction({type: "INCREASE", diff}, tp)
    p2pServer.broadcastTransaction(transaction)
  } catch (error){
    if(error instanceof InvalidPerissonsError){
      statusCode = 401
    } else {
      statusCode = 400
    }
    console.log(error.stack)
  }
  res
  .status(200)
  .set('Content-Type', 'application/json')
  .send(result)
  .end();
})

// We will want changes in ports and the database to be broadcaste across
// all instances so lets pass this info into the p2p server
app.listen(PORT, () => {
  console.log(`App listening on port ${PORT}`);
  console.log('Press Ctrl+C to quit.');
});
// [END gae_flex_mysql_app]


// Lets start this p2p server up so we listen for changes in either DATABASE
// or NUMBER OF SERVERS
p2pServer.listen()

module.exports = app;

if (METHOD == "POS"){

  const cron = require("node-cron");
  // schedule tasks to be run on the server

  setTimeout(setCron,  1000);

  function setCron(){
    console.log("Setting Cron")
    cron.schedule("*/6 * * * * *", function() {
      if (p2pServer.votingRound.status === "SUCCESS" || p2pServer.votingRound.status === "FAILURE" ){
        try{
        p2pServer.startNewRound()
        } catch (err){
          console.log(err.stack)
        }
      } else {
        console.log(`Current round status ${p2pServer.votingRound.status}`)
      }
  })
  }
}
