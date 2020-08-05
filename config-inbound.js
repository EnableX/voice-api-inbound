config={};

config.voice_server_host = 'api.enablex.io';
config.voice_server_port = 443;
config.path = '/voice/v1/calls';
config.app_id = '5f1e99bf90ef8078052e6462';
config.app_key = 'Ry3uEurydeSyTuReXaDuMe9u7ysasamutaby';
config.ngrok = true;
config.webhook_host = 'https://554705a649f0.ngrok.io'; // Needs to provide if ngrok = false
config.webhook_port = 5000;
config.certificate = {
    ssl_key: "/certs/example.key",               // Path to .key file
    ssl_cert : "/certs/example.crt",             // Path to .crt file
    ssl_ca_certs : ["/certs/example.ca-bundle"]    // Path to CA[chain]
};

var module = module || {};
module.exports = config;
