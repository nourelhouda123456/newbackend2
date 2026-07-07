import admin from 'firebase-admin';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

let isFirebaseConfigured = false;

try {
  // If FIREBASE_SERVICE_ACCOUNT_PATH is set in .env
  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH && fs.existsSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)) {
    const serviceAccount = JSON.parse(fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    isFirebaseConfigured = true;
    console.log('Firebase Admin initialized successfully.');
  } 
  // Else if FIREBASE_SERVICE_ACCOUNT_JSON is set (raw JSON string in .env)
  else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    isFirebaseConfigured = true;
    console.log('Firebase Admin initialized successfully.');
  } else {
    console.warn('Firebase Admin NOT initialized. Please set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON in your .env file.');
  }
} catch (error) {
  console.error('Error initializing Firebase Admin:', error.message);
}

export const sendPushNotification = async (fcmToken, title, body, data = {}) => {
  if (!isFirebaseConfigured || !fcmToken) return;

  const message = {
    notification: {
      title,
      body,
    },
    data,
    token: fcmToken,
  };

  try {
    const response = await admin.messaging().send(message);
    console.log('Successfully sent message:', response);
  } catch (error) {
    console.error('Error sending message:', error);
  }
};

export default admin;
