// Import the required libraries
const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');
const axios = require('axios');
const { Configuration, OpenAIApi } = require("openai");
const speech = require('@google-cloud/speech');
const client1 = new speech.SpeechClient();
const textToSpeech = require('@google-cloud/text-to-speech');
const fs = require('fs');
const util = require('util');
const client = new textToSpeech.TextToSpeechClient();
const express = require('express');
const app = express();
const path = require('path');
require('dotenv').config()
const opn = require('opn');
const player = require('play-sound')(opts = {});
// trial code
const { sdk } = require('@symblai/symbl-js');
const appId = process.env.APP_ID
const appSecret = process.env.APP_SECRET

async function processMessages(messages) {
  for (const message of messages) {
    try {
      const gptResponse = await generateGptResponse(message.payload.content);
      const audioResponse = await convertTextToSpeech(gptResponse);
      playAudioInZoom(audioResponse);
      process.stdout.write('Message: ' + message.payload.content + '\n');
    } catch (error) {
      console.error('An error occurred:', error);
    }
  }
}
//trial code ends



// Set up Zoom credentials
const zoomClientId = process.env.ZOOM_API_KEY;
const zoomClientSecret = process.env.ZOOM_API_SECRET;
const zoomRedirectUri = process.env.ZOOM_REDIRECT_URI;


// Set up OpenAI credentials
const configuration = new Configuration({
  organization: "org-bZ4ydvkd2CNltfXkKsef4JyZ",
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);





// Function to authorize and obtain an access token from Zoom
async function authorizeZoom() {
  // try {
    // Obtain the authorization code from the user
    const authorizationCode = await getUserAuthorizationCode();

    // Exchange the authorization code for an access token
    const tokenUrl = 'https://zoom.us/oauth/token';
    const tokenParams = {
      grant_type: 'authorization_code',
      code: authorizationCode,
      redirect_uri: zoomRedirectUri,
    };

    const response = await axios.post(tokenUrl, null, {
      auth: {
        username: zoomClientId,
        password: zoomClientSecret,
      },
      params: tokenParams,
    });

    const accessToken = response.data.access_token;

    return accessToken;
  
  // } catch (error) {
  //   throw new Error('Error authorizing Zoom');
  // }
}

// Function to obtain the authorization code from the user
async function getUserAuthorizationCode() {
  return new Promise((resolve, reject) => {
    // Set up a route to handle the authorization code callback from Zoom
    app.get('/zoom-callback', (req, res) => {
      const authorizationCode = req.query.code;
      res.send('Authorization successful! You can close this page now.');
      app.emit('authorizationCodeReceived');
      resolve(authorizationCode);
    });

    // Start the server to listen for the callback
    const server = app.listen(3000, () => {
      console.log('Server listening on port 3000');
    });

    // Redirect the user to the Zoom authorization URL
    const authorizationUrl = `https://zoom.us/oauth/authorize?response_type=code&client_id=${zoomClientId}&redirect_uri=${zoomRedirectUri}`;

    // Open the authorization URL in a browser
    opn(authorizationUrl);

    // Wait for the user to grant permission and for the authorization code callback to be received
    app.on('authorizationCodeReceived', () => {
      server.close(); // Close the server once the callback is received
    });
  });
}

// Function to join a Zoom meeting using the access token
async function joinZoomMeeting(meetingLink, accessToken) {
  try {
    const meetingNumber = getMeetingNumberFromLink(meetingLink);

    // Generate a unique name for the bot
    const botName = `Bot-${uuidv4()}`;

    // Join the Zoom meeting using the bot user's credentials
    const meetingUrl = await joinMeeting(meetingNumber, accessToken, botName);

    console.log(`Bot ${botName} joined the meeting: ${meetingUrl}`);
    opn(meetingUrl);
  } catch (error) {
    console.error('Error joining Zoom meeting:', error.message);
  }
}

// Function to extract meeting number from Zoom meeting link
function getMeetingNumberFromLink(meetingLink) {
  const url = new URL(meetingLink);
  const pathName = url.pathname;
  const parts = pathName.split('/');
  const meetingNumber = parts[parts.length - 1];
  return meetingNumber;
}



// Function to join a Zoom meeting using the JWT token
async function joinMeeting(meetingNumber, accessToken, botName) {
  try {
    const meetingUrl = `https://zoom.us/wc/${meetingNumber}/join?prefer=1&un=${encodeURIComponent(botName)}&pwd=&access_token=${accessToken}`;
    return meetingUrl;
  } catch (error) {
    throw new Error('Error joining Zoom meeting');
  }
}


// Function to start PSTN Connection
async function startPSTNConnection(ZOOM_MEETING_ID, ZOOM_PARTICIPANT_ID, ZOOM_MEETING_PASSCODE, phoneNumber, meetingName) {
  let dtmfSequence = `${ZOOM_MEETING_ID}#`;

if (ZOOM_PARTICIPANT_ID) {
  dtmfSequence += `,,${ZOOM_PARTICIPANT_ID}#`;
} else {
  dtmfSequence += `,,#`;
}

if (ZOOM_MEETING_PASSCODE) {
  dtmfSequence += `,,${ZOOM_MEETING_PASSCODE}#`;
}

  try {
    // Initialize the SDK
    await sdk.init({
      appId: appId,
      appSecret: appSecret,
      basePath: 'https://api.symbl.ai',
    });

    console.log('SDK Initialized');

    const connection = await sdk.startEndpoint({
      endpoint: {
        type: 'pstn',
        phoneNumber: phoneNumber,
        dtmf: dtmfSequence,
      },
      data: {
        session: {
          name: meetingName,
        },
      },
    });

    const connectionId = connection.connectionId;
    console.log('Successfully connected. Connection ID: ', connectionId);

    console.log('Subscribing to the live events on the connection.');
    sdk.subscribeToConnection(connectionId, (data) => {
      const { type } = data;
      if (type === 'transcript_response') {
        const { payload } = data;
        process.stdout.write('Live: ' + payload && payload.content + '\r');
      } else if (type === 'message_response') {
        const { messages } = data;
        processMessages(messages);
      }
    });
  } catch (e) {
    console.log(e);
  }
}



// Function to generate a response from GPT-3
async function generateGptResponse(text) {
  try {
    const message = [{"role": "system", "content": "You are a helpful assistant."}, {"role": "user", "content": text}]
    const response = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: message,
    });

    return response.data.choices[0].message.content;
  } catch (error) {
    throw new Error('Error generating GPT-3 response');
  }
}

// Function to convert text to speech using an external text-to-speech engine
async function convertTextToSpeech(text) {
  // Code to convert text to speech using an external text-to-speech engine
  const request = {
    input: { text: text },
    voice: { languageCode: 'en-US', ssmlGender: 'NEUTRAL' },
    audioConfig: { audioEncoding: 'MP3' },
  };

  const [response] = await client.synthesizeSpeech(request);
  // Write the binary audio content to a local file
  const filePath = 'output.mp3';
  const writeFile = util.promisify(fs.writeFile);
  await writeFile(filePath, response.audioContent, 'binary');
  console.log('Audio content written to file:', filePath);
  return filePath;
}

// Function to play the audio response in the Zoom meeting
function playAudioInZoom(audioFile) {
  const filePath = path.join(__dirname, audioFile); // Construct the full path to the audio file
  player.play(filePath, function (err) {
    if (err) {
      console.error('Error playing audio:', err);
    } else {
      console.log('Audio playback completed');
    }
  });
}




// Example usage
async function main() {

  // Step 1: Authorize and obtain the access token from Zoom
  const accessToken = await authorizeZoom();

  // Step 2: Get meeting link
  const meetingLink = "https://us04web.zoom.us/j/79018319254?pwd=SyblNuDU2t1PCZbSaQGJjlaDvV6rIb.1";

  // Step 3: Join the Zoom meeting
  await joinZoomMeeting(meetingLink, accessToken);

  const phoneNumber = '+13462487799';
  const meetingName = 'Aditi';

  const ZOOM_PARTICIPANT_ID = 517886;
  const ZOOM_MEETING_ID = 79018319254;
  const ZOOM_MEETING_PASSCODE = 109055;

  await startPSTNConnection(ZOOM_MEETING_ID, ZOOM_PARTICIPANT_ID, ZOOM_MEETING_PASSCODE, phoneNumber, meetingName);
}

main().catch(error => {
  console.error('An error occurred:', error);
});
