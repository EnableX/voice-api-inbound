const config = {};

config.voice_server_host = 'api.enablex.io';
config.voice_server_port = 443;
config.path = '/voice/v1/calls';
config.app_id = '';
config.app_key = '';
config.ngrok = true;
config.webhook_host = ''; // Needs to provide if ngrok = false
config.webhook_port = 5000;
config.certificate = {
  ssl_key: '/certs/example.key', // Path to .key file
  ssl_cert: '/certs/example.crt', // Path to .crt file
  ssl_ca_certs: ['/certs/example.ca-bundle'], // Path to CA[chain]
};

module.exports = config;
