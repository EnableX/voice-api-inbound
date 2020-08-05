const https = require('https');
const events = require('events');
const express = require('express');

const eventEmitter = new events.EventEmitter();
const bodyParser = require('body-parser');
const crypto = require('crypto');
const ngrok = require('ngrok');
const _ = require('lodash');
const { readFileSync } = require('fs');
const config = require('./config-inbound');
const logger = require('./logger');
const {
  makeVoiceAPICall, hangupCall, onError,
} = require('./voiceapi');

const app = express();
let activeCall = false;
let url = '';
let retryCounter = 0;
let digitcollected = false;
let server;
/* Object to maintain Call Details */
const call = {};
const consoleLog = [];

function onListening() {
  logger.info(`Listening on Port ${config.webhook_port}`);
}

function shutdown() {
  server.close(() => {
    logger.error('Shutting down the server');
    process.exit(0);
  });
  setTimeout(() => {
    process.exit(1);
  }, 10000);
}

/* Initializing WebServer */
if (config.ngrok === true) {
  server = app.listen(config.webhook_port, () => {
    logger.info(`Server running on port ${config.webhook_port}`);
    // eslint-disable-next-line wrap-iife
    (async () => {
      try {
        url = await ngrok.connect({ proto: 'http', addr: config.webhook_port });
        console.log('ngrok tunnel set up:', url);
      } catch (error) {
        console.log(`Error happened while trying to connect via ngrock ${JSON.stringify(error)}`);
        shutdown();
        return;
      }
      url += '/event';
      console.log('Update this URL in portal, to receive incoming calls: ', url);
    })();
  });
} else if (config.ngrok === false) {
  const options = {
    key: readFileSync(config.certificate.ssl_key).toString(),
    cert: readFileSync(config.certificate.ssl_cert).toString(),
  };
  if (config.certificate.ssl_ca_certs) {
    options.ca = [];
    options.ca.push(readFileSync(config.certificate.ssl_ca_certs).toString());
  }
  server = https.createServer(options, app);
  app.set('port', config.webhook_port);
  server.listen(config.webhook_port);

  server.on('error', onError);
  server.on('listening', onListening);
  url = `https://${config.webhook_host}:${config.webhook_port}/event`;
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static('client'));

function constructSSE(res, id, data) {
  res.write(`id: ${id}\n`);
  res.write(`data: ${data}\n\n`);
}

function sendSSE(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const id = (new Date()).toLocaleTimeString();

  setInterval(() => {
    if (!_.isEmpty(consoleLog[0])) {
      const data = `${consoleLog[0]}`;
      constructSSE(res, id, data);
      consoleLog.pop();
    }
  }, 100);
}

app.get('/event-stream', (req, res) => {
  sendSSE(req, res);
});

app.post('/event', (req, res) => {
  const appId = config.app_id;

  const key = crypto.createDecipher(req.headers['x-algoritm'], appId);
  let decryptedData = key.update(req.body.encrypted_data, req.headers['x-format'], req.headers['x-encoding']);
  decryptedData += key.final(req.headers['x-encoding']);
  const jsonObj = JSON.parse(decryptedData);

  res.statusCode = 200;
  res.send();
  res.end();
  eventEmitter.emit('voicestateevent', jsonObj);
});

function timeOutHandler() {
  logger.info(`[${call.voice_id}] Disconnecting the call`);
  hangupCall(`${config.path}/${call.voice_id}`, () => {});
}

/* WebHook Event Handler function */
function voiceEventHandler(voiceEvent) {
  if (activeCall === false && voiceEvent.state === 'incomingcall') {
    activeCall = true;
    call.voice_id = voiceEvent.voice_id;
    logger.info(`[${call.voice_id}] Received an inbound Call`);
    consoleLog.push(`Received an inbound Call with id ${call.voice_id}`);
  } else if (voiceEvent.state && voiceEvent.state === 'disconnected') {
    logger.info(`[${call.voice_id}] Call is disconnected`);
    consoleLog.push('Call is disconnected');
    activeCall = false;
    retryCounter = 0;
    digitcollected = false;
  } else if (voiceEvent.playstate !== undefined) {
    if (voiceEvent.playstate === 'playfinished' && voiceEvent.prompt_ref === '3') {
      logger.info(`[${call.voice_id}] DTMF prompt played, Disconnecting the call in 10 Sec`);
      consoleLog.push('DTMF prompt played, Disconnecting the call in 10 Sec');
      setTimeout(timeOutHandler, 10000);
    } else if (voiceEvent.playstate === 'playfinished' && voiceEvent.prompt_ref === '2') {
      if (digitcollected === false) {
        logger.info(`[${call.voice_id}] 1st Level IVR menu is finished, Disconnecting the call in 10 Sec`);
        consoleLog.push('1st Level IVR menu is finished, Disconnecting the call in 10 Sec');
        setTimeout(timeOutHandler, 10000);
      }
    } else if (voiceEvent.playstate === 'digitcollected' && voiceEvent.prompt_ref === '2') {
      digitcollected = true;
      logger.info(`[${call.voice_id}] Received DTMF Digit ${voiceEvent.digit}`);
      consoleLog.push(`Received DTMF Digit ${voiceEvent.digit}`);
      const dtmfPrompt = `DTMF received is ${voiceEvent.digit}, Disconnecting the call in 10 seconds`;
      const playCommand = JSON.stringify({
        play: {
          text: dtmfPrompt,
          voice: 'female',
          language: 'en-US',
          prompt_ref: '3',
        },
      });
      makeVoiceAPICall(`${config.path}/${call.voice_id}`, playCommand, () => {});
    } else if (voiceEvent.playstate === 'playfinished') {
      logger.info(`[${call.voice_id}] Greeting is completed, Playing IVR Menu`);
      consoleLog.push('Greeting is completed, Playing IVR Menu');
      /* Playing IVR menu using TTS */
      const playCommand = JSON.stringify({
        play: {
          text: 'This is the 1st level IVR menu, please press 1 for accounts, press 2 for engineering, press 3 to connect to a agent',
          voice: 'female',
          language: 'en-US',
          dtmf: true,
          interrupt: false,
          prompt_ref: '2',
        },
      });
      makeVoiceAPICall(`${config.path}/${call.voice_id}`, playCommand, () => {});
    } else if ((retryCounter !== 3) && voiceEvent.playstate === 'menutimeout' && voiceEvent.prompt_ref === '2') {
      consoleLog.push('You have not provided any digit, Please press a digit, please press 1 for accounts, press 2 for engineering, press 3 to connect to a agent');
      retryCounter += 1;
      const playCommand = JSON.stringify({
        play: {
          text: 'You have not provided any digit, Please press a digit, please press 1 for accounts, press 2 for engineering, press 3 to connect to a agent',
          voice: 'female',
          language: 'en-US',
          dtmf: true,
          interrupt: false,
          prompt_ref: '2',
        },
      });
      makeVoiceAPICall(`${config.path}/${call.voice_id}`, playCommand, () => {});
    } else {
      consoleLog.push('You have not provided any digit, Disconnecting the call in 10 seconds');
      const playCommand = JSON.stringify({
        play: {
          text: 'You have not provided any digit, Disconnecting the call in 10 seconds',
          voice: 'female',
          language: 'en-US',
          prompt_ref: '3',
        },
      });
      makeVoiceAPICall(`${config.path}/${call.voice_id}`, playCommand, () => {});
    }
  } else if (activeCall === true && voiceEvent.state === 'incomingcall') {
    logger.info(`Already 1 call is active, Rejecting this Incoming Call ${voiceEvent.voice_id}`);
    consoleLog.push(`Already 1 call is active, Rejecting this Incoming Call ${voiceEvent.voice_id}`);
    hangupCall(`${config.path}/${voiceEvent.voice_id}`, () => {});
  }
}

process.on('SIGINT', () => {
  logger.info('Caught interrupt signal');
  shutdown();
});

/* Registering WebHook Event Handler function */
eventEmitter.on('voicestateevent', voiceEventHandler);
