#!/usr/bin/env bash

dotenv=./.env
touch $dotenv

echo "APP_ID_IOS=$APP_ID_IOS" >> $dotenv
echo "APP_VERSION_NAME=$APP_VERSION_NAME" >> $dotenv
echo "APP_VERSION_CODE=$APP_VERSION_CODE" >> $dotenv

echo "SUBMIT_URL=$SUBMIT_URL" >> $dotenv
echo "RETRIEVE_URL=$RETRIEVE_URL" >> $dotenv

echo "HMAC_KEY=$HMAC_KEY" >> $dotenv
echo "SENTRY_DSN=$SENTRY_DSN" >> $dotenv

echo "TEST_MODE=$TEST_MODE" >> $dotenv
echo "MOCK_SERVER=$MOCK_SERVER" >> $dotenv

echo "MCC_CODE=$MCC_CODE" >> $dotenv
echo "TRANSMISSION_RISK_LEVEL=$TRANSMISSION_RISK_LEVEL" >> $dotenv
echo "MINIMUM_FETCH_INTERVAL=$MINIMUM_FETCH_INTERVAL" >> $dotenv

cat $dotenv

yarn install
bundle install && yarn pod-install
