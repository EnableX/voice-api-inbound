const https = require('https');
var events = require('events');
var express = require("express");
var eventEmitter = new events.EventEmitter();
var bodyParser = require("body-parser");
var config = require('./config-inbound');
var crypto = require('crypto');
var ngrok = require('ngrok');
var fs = require('fs');
var app = express();
var active_call = false;
var url = '';
var retry_counter = 0;
var digitcollected = false;

/* Function to make REST API Calls */
var makeVoiceAPICall = function(hostName, port, path,  data, callback) {

    let options = {
        host: hostName,
        port: port,
        path: path,
        method: 'POST',
        headers: {
            'Authorization': 'Basic ' + new Buffer(config.app_id + ':' + config.app_key).toString('base64'),
            'Content-Type': 'application/json',
            'Content-Length': data.length
        }   
    };
    req = https.request(options, function(res) {
        var body = "";
        res.on('data', function(data) {
            body += data;
        });

        res.on('end', function() {
            callback(body);
        });

        res.on('error', function(e) {
            console.log("Got error: " + e.message);
        });
    });

    req.write(data);
    req.end();
}


/* Initializing WebServer */
if(config.ngrok === true) {
    var server = app.listen(config.webhook_port, () => {
        console.log("Server running on port " + config.webhook_port);
        (async function() {
            try {
                url = await ngrok.connect(
                                    {proto : 'http',
                                    addr : config.webhook_port});
                console.log('ngrok tunnel set up:', url);
            } catch(error) {
                console.log("Error happened while trying to connect via ngrock " + JSON.stringify(error));
                shutdown();
                return;
            }
            url = url+'/event';
            console.log('Update this URL in portal, to receive incoming calls: ', url);
        })();
    });
} else {
    if(config.ngrok === false){
        var options = {
            key: fs.readFileSync(config.certificate.ssl_key).toString(),
            cert: fs.readFileSync(config.certificate.ssl_cert).toString(),
        }
        if (config.certificate.ssl_ca_certs) {
            options.ca = [];
            for (var ca in config.certificate.ssl_ca_certs) {
                options.ca.push(fs.readFileSync(config.certificate.ssl_ca_certs[ca]).toString());
            }
        }
        var server = https.createServer(options, app);
        app.set('port', config.webhook_port);
        server.listen(config.webhook_port);

        server.on('error', onError);
        server.on('listening', onListening);
        url = 'https://' + config.webhook_host + ':' + config.webhook_port + '/event';
    }
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));

app.post("/event", (req, res, next) => {
    var appId = config.app_id;

    var key = crypto.createDecipher(req.headers['x-algoritm'], appId);
    var decryptedData = key.update(req.body['encrypted_data'], req.headers['x-format'], req.headers['x-encoding']);
    decryptedData += key.final(req.headers['x-encoding']);
    var json_obj = JSON.parse(decryptedData);

    res.statusCode = 200;
    res.send();
    res.end();
    eventEmitter.emit('voicestateevent', json_obj);
});


/* Function to Hangup Call */
var hangupCall = function(hostName, port, path, callback) {
    let options = {
        host: hostName,
        port: port,
        path: path,
        method: 'DELETE',
        headers: {
            'Authorization': 'Basic ' + new Buffer(config.app_id + ':' + config.app_key).toString('base64'),
            'Content-Type': 'application/json',
        }   
    };
    req = https.request(options, function(res) {
        var body = "";
        res.on('data', function(data) {
            body += data;
        });

        res.on('end', function() {
            callback(body);
        });

        res.on('error', function(e) {
            console.log("Got error: " + e.message);
        });
    });

    req.end();
}


var timeOutHandler = function() {
    console.log("[" + call.voice_id + "] Disconnecting the call");
    hangupCall(config.voice_server_host, config.voice_server_port, config.path + '/' + call.voice_id, function(response) {
        return;
    });
}

/* WebHook Event Handler function*/
var voiceEventHandler = function(voiceEvent) {
    if(active_call === false && voiceEvent.state === 'incomingcall') {
        active_call = true;
        call.voice_id = voiceEvent.voice_id;
        console.log("[" + call.voice_id + "] Received an inbound Call");
    } else if(voiceEvent.state && voiceEvent.state === 'disconnected') {
        console.log("[" + call.voice_id + "] Call is disconnected");
        active_call = false;
        retry_counter = 0;
        digitcollected = false;
    } else if(voiceEvent.playstate !== undefined) {
        if(voiceEvent.playstate === 'playfinished' && voiceEvent.prompt_ref === '3') {
            console.log("[" + call.voice_id + "] DTMF prompt played, Disconnecting the call in 10 Sec");
            setTimeout(timeOutHandler, 10000);
        } else if(voiceEvent.playstate === 'playfinished' && voiceEvent.prompt_ref === '2') {
            if(digitcollected === false){
                console.log("[" + call.voice_id + "] 1st Level IVR menu is finished, Disconnecting the call in 10 Sec");
                setTimeout(timeOutHandler, 10000);
            }
        } else if(voiceEvent.playstate === 'digitcollected' && voiceEvent.prompt_ref === '2') {
            digitcollected = true;
            console.log("[" + call.voice_id + "] Received DTMF Digit " + voiceEvent.digit);
            var dtmf_prompt = "DTMF received is " + voiceEvent.digit + ", Disconnecting the call in 10 seconds";
            let playCommand = JSON.stringify({
                  "play": {
                    "text": dtmf_prompt,
                    "voice": "female",
                    "language": "en-US",
                    "prompt_ref":"3"
                  }
            });
            makeVoiceAPICall(config.voice_server_host, config.voice_server_port, config.path + '/' + call.voice_id, playCommand,
                function(response) {
                  });
        } else if(voiceEvent.playstate === 'playfinished') {
            console.log("[" + call.voice_id + "] Greeting is completed, Playing IVR Menu");
            /* Playing IVR menu using TTS */
            let playCommand = JSON.stringify({
                  "play": {
                    "text":"This is the 1st level IVR menu, please press 1 for accounts, press 2 for engineering, press 3 to connect to a agent",
                    "voice": "female",
                    "language": "en-US",
                    "dtmf":true,
                    "interrupt":false,
                    "prompt_ref":"2"
                  }
            });
            makeVoiceAPICall(config.voice_server_host, config.voice_server_port, config.path + '/' + call.voice_id, playCommand,
                function(response) {
                  });
        } else if((retry_counter !== 3) && voiceEvent.playstate === 'menutimeout' && voiceEvent.prompt_ref === '2'){
            retry_counter = retry_counter + 1; 
            let playCommand = JSON.stringify({
                  "play": {
                    "text":"You have not provided any digit, Please press a digit, please press 1 for accounts, press 2 for engineering, press 3 to connect to a agent",
                    "voice": "female",
                    "language": "en-US",
                    "dtmf":true,
                    "interrupt":false,
                    "prompt_ref":"2"
                  }
            });
            makeVoiceAPICall(config.voice_server_host, config.voice_server_port, config.path + '/' + call.voice_id, playCommand,
                function(response) {
                  });
        } else {
            let playCommand = JSON.stringify({
                  "play": {
                    "text":"You have not provided any digit, Disconnecting the call in 10 seconds",
                    "voice": "female",
                    "language": "en-US",
                    "prompt_ref":"3"
                  }
            });
            makeVoiceAPICall(config.voice_server_host, config.voice_server_port, config.path + '/' + call.voice_id, playCommand,
                function(response) {
                });
        } 
    } else if(active_call === true && voiceEvent.state === 'incomingcall'){
        console.log("Already 1 call is active, Rejecting this Incoming Call " + voiceEvent.voice_id);
        hangupCall(config.voice_server_host, config.voice_server_port, config.path + '/' + voiceEvent.voice_id, function(response) {
            return;
        });
    }
};

function onError(error) {
    if (error.syscall !== 'listen') {
        throw error;
    }

    switch (error.code) {
        case 'EACCES':
            console.error('Port ' + config.webhook_port + ' requires elevated privileges');
            process.exit(1);
        break;
        case 'EADDRINUSE':
            console.error('Port ' + config.webhook_port + ' is already in use');
            process.exit(1);
        break;
        default:
            throw error;
    }
}

function onListening() {
    console.log('Listening on Port ' + config.webhook_port);
};

process.on('SIGINT', function() {
    console.log("Caught interrupt signal");
    shutdown();
});

var shutdown = function() {
    server.close(() => {
        console.error('Shutting down the server');
        process.exit(0);
        });
    setTimeout(() => {
        process.exit(1);
        }, 10000);
};

/* Object to maintain Call Details */
var call = {};

/* Registering WebHook Event Handler function*/
eventEmitter.on('voicestateevent', voiceEventHandler);
