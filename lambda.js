let AWS = require('aws-sdk');
let sqs = new AWS.SQS();
let date = require('date-and-time');
const ddb = new AWS.DynamoDB.DocumentClient();
const sns = new AWS.SNS();

exports.handler = (event, context, callback) => {
    
    sqs.receiveMessage({
        QueueUrl: '<<queue_url>>',  // URL of your queue
        AttributeNames: ['All'],
        MaxNumberOfMessages: '10',
        VisibilityTimeout: '30',
        WaitTimeSeconds: '20'
    }).promise()
        .then(data => {
            data.Messages.forEach(message => {      // Going through all the fetched messages in this attempt
                console.log("Received message with payload", message.Body);

                let messageBody = JSON.parse(message.Body);

                let bookingDateObj = new Date();
                let startingDateObj = date.parse(messageBody.bookingRequest.startDate, 'YYYY-MM-DD');
                let endingDateObj = date.parse(messageBody.bookingRequest.endDate, 'YYYY-MM-DD');

                let failure = messageBody.bookingReqProcessingState === "Failed";       // Check whether it's a booking failure
                if (failure) {
                    let notificationMsg = "Notifying about booking failure for booking reference :" + messageBody.bookingRef;

                    sns.publish({                                   // Notifying booking failure via an SMS message using SNS
                        Message: notificationMsg,
                        MessageAttributes: {
                            'AWS.SNS.SMS.SMSType': {
                                DataType: 'String',
                                StringValue: 'Promotional'
                            },
                            'AWS.SNS.SMS.SenderID': {
                                DataType: 'String',
                                StringValue: 'BkFailures'
                            }
                        },
                        PhoneNumber: '<<phone_number>>'                 // Your phone number goes here to get an SMS notification
                    }).promise()
                        .then(data => {
                            console.log("Successfully sent notification to the operator with response :" + JSON.stringify(data));
                        })
                        .catch(err => {
                            console.log("Error while sending notification SMS", err);
                        });
                }

                let gapForBookingStartDate = date.subtract(startingDateObj, bookingDateObj).toDays();
                let gapBetweenBookingDates = date.subtract(endingDateObj, startingDateObj).toDays();

                // Check whether is it a booking anomaly. In this example it's detected as an anomaly if booking start date is
                // 6 months (180 days) away from the current date or booking date range is greater than 20 days
                if (gapBetweenBookingDates > 20 || gapForBookingStartDate > 180) {
                    let insertTimeStr = date.format(new Date(), 'YYYY-MM-DD HH:mm:ss');
                    ddb.put({
                        TableName: 'BookingInfoAnomalies',
                        Item: {
                            'ResellerID': messageBody.resellerId,
                            'BookingRef': messageBody.bookingRef,
                            'BookingState': !failure,
                            'StartDate': messageBody.bookingRequest.startDate,
                            'EndDate': messageBody.bookingRequest.endDate,
                            'Pax': messageBody.bookingRequest.pax,
                            'City': messageBody.bookingRequest.city,
                            'Grade': messageBody.bookingRequest.grade,
                            'InsertTime': insertTimeStr
                        }
                    }).promise()
                        .then(data => {
                            console.log("Successfully inserted booking ref : " + messageBody.bookingRef +
                                " to DynamoDB with response : " + JSON.stringify(data));
                        })
                        .catch(err => {
                            console.log("Error while inserting data to DynamoDB due to : ", err);
                        });
                }

                sqs.deleteMessage({                         // Deleting process message to make sure it's not processed again
                    QueueUrl: "<<queue_url>>",  // URL of your queue
                    ReceiptHandle: message.ReceiptHandle

                }).promise()
                    .then(data => {
                        console.log("Successfully deleted message with ReceiptHandle : " + message.ReceiptHandle +
                            "and booking reference : " + messageBody.bookingRef + " with response :" + JSON.stringify(data));
                    })
                    .catch(err => {
                        console.log("Error while deleting the fetched message with ReceiptHandle : " + message.ReceiptHandle +
                            "and booking reference : " + messageBody.bookingRef, err);
                    });

            });
        })
        .catch(err => {
            console.log("Error while fetching messages from the sqs queue", err);
        });


    callback(null, 'Lambda execution completed');
};

