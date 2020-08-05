# **Basic Client Examples to demonstrate Inbound Calls using Enablex Voice APIs. **
This example contains instructions how users can initiate Inbound Calls.

## Prerequisite
- You will need Enablex Application credentials, app_id and app_key.
- You will need to configure the inbound phone number you purchased from Enablex.
- You will need a place for hosting this application either cloud or local machine.


## Installation
- git clone {repo_url}
- cd {git_directory}
- npm install

## Setting up configurations.
- Set app_id and app_key & other parameters in config file.
- For Inbound call client, Open config-outbound.js and set Enablex Application credentials, app_id and app_key
  - config.app_id
  - config.app_key
- For Inbound Calls
  - User needs to update the WebHook URL in the portal to receive WebHook events. The Webhook url needs to be publically reachable URL.
    - If you are running your server in public environment, please update the web hook URL.
    - If you are running it in local, you can make use of the ngrok options from the configuration options. Anytime your Webhook URL changes, you need to update the event url in the portal to receive calls.

## Webhook security
- Webhook security is also implemented as part of the voice service APIs.
- Enablex Voice Server does encryption of Webhook payload using 'md5' encryption and app_id as key.
- Client needs to do decryption of payload using app_id provided by Enablex and algorithm, format, encoding parameters present in x-algoritm, x-format and x-encoding header.
- Please refer to the documentation and examples for proper way of handling Webhook payloads.

## Starting the client application script
- For Inbound Calls, cd inbound
  - node client-inbound.js
