export const config = {
  port: Number(process.env.PORT || 3000),
  environment: process.env.NODE_ENV || 'development',
  firebaseServiceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || ''
};
