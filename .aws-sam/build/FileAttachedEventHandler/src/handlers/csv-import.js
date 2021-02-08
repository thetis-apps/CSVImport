const axios = require('axios');

const csvParser = require('csv-parser');

const stripBom = require('strip-bom-stream');

var iconv = require('iconv-lite');

var AWS = require('aws-sdk');
AWS.config.update({region:'eu-west-1'});

var sqs = new AWS.SQS({apiVersion: '2012-11-05'});


async function getIMS() {
	
    const authUrl = "https://auth.thetis-ims.com/oauth2/";
    const apiUrl = "https://api.thetis-ims.com/2/";

	var clientId = process.env.ClientId;   
	var clientSecret = process.env.ClientSecret; 
	var apiKey = process.env.ApiKey;  
	
    let data = clientId + ":" + clientSecret;
	let base64data = Buffer.from(data, 'UTF-8').toString('base64');	
	
	var imsAuth = axios.create({
			baseURL: authUrl,
			headers: { Authorization: "Basic " + base64data, 'Content-Type': "application/x-www-form-urlencoded" },
			responseType: 'json'
		});
    
    var response = await imsAuth.post("token", 'grant_type=client_credentials');
    var token = response.data.token_type + " " + response.data.access_token;
    
    var ims = axios.create({
    		baseURL: apiUrl,
    		headers: { "Authorization": token, "x-api-key": apiKey, "Content-Type": "application/json" },
    	    validateStatus: function (status) {
		            return status >= 200 && status < 300 || status == 422; 
		        }
    	});
	
	ims.interceptors.response.use(function (response) {
			console.log("SUCCESS " + JSON.stringify(response.data));
 	    	return response;
		}, function (error) {
			console.log(JSON.stringify(error));
			if (error.response) {
				console.log("FAILURE " + error.response.status + " - " + JSON.stringify(error.response.data));
			}
	    	return Promise.reject(error);
		});

	return ims;
}

const parse = (inputStream, setup) => {
    return new Promise((resolve, reject) => {
            let results = [];
            inputStream.pipe(stripBom()).pipe(iconv.decodeStream(setup.encoding)).pipe(csvParser(setup.options))
            .on('data', (data) => {
                console.log("data " + JSON.stringify(data));
                results.push(data);
            })
            .on('end', () => {
                console.log("end" + JSON.stringify(results));
                resolve(results);
            });
    });
};

async function error(ims, eventId, data, lineNumber) {
	let message = new Object();
	message.time = Date.now();
	message.source = "CSVImport";
	message.messageType = data.messageType;
	message.messageText = "Line " + lineNumber + ": " + data.messageText;
	await ims.post("events/" + eventId + "/messages", message);
}

async function sendSqs(chunk) {
    var params = {
        MessageBody: JSON.stringify(chunk),
        QueueUrl: process.env.DispatchQueue
    };
    await sqs.sendMessage(params).promise();
}

/**
 * A Lambda function that logs the payload received from a CloudWatch scheduled event.
 */
exports.fileAttachedEventHandler = async (event, context) => {
    
    let detail = event.detail;
    let presignedUrl = detail.url;
    
    let resourceName = detail.data.resourceName;
    
    let dataDocument = JSON.parse(detail.data.dataDocument);
    
    let setups = dataDocument.CSVImport;
    let found = false;
    let i = 0;
    while (i < setups.length && !found) {
        if (detail.fileName.match(setups[i].fileNamePattern)) {
            found = true;
        } else {
            i++;
        }
    }
    if (!found) {
        return "SKIP";
    }
    
    let setup = setups[i];
    let options = setup.options;
    
    console.log(JSON.stringify(options));

    let response = await axios.get(presignedUrl, { responseType: 'stream' });
    
    console.log("Got stream");
    
    let results = await parse(response.data, setup);  
    
    console.log("Got result " + JSON.stringify(results));

    // For each line in the file
    
    let chunk = [];
    for (let i = 0; i < results.length; i++) {
        let data = results[i];
        
        // Enrich line with metadata
        
        let metadata = new Object();
        metadata.lineNumber = i;
        metadata.resourceName = resourceName;
        metadata.eventId = detail.eventId;
        data.metadata = metadata;        
        
        chunk.push(data);
        
        // Make chunks of 50 lines for the writer
        
        if (i > 0 && i % 50 == 0) {
            await sendSqs(chunk);
            chunk = [];
        } 
    }
    
    // Send remainder
    
    if (chunk.length > 0) {
        await sendSqs(chunk);
    }

}

exports.writer = async (event, x) => {
    
    let ims = await getIMS();

    // For each SQS message
    
    let records = event.Records;
    for (let i = 0; i < records.length; i++) {
        let record = records[0];
        
        // For each line read from a file
        
        let results = JSON.parse(record.body);
        for (let j = 0; j < results.length; j++) {
            let data = results[j];
            let metadata = data.metadata;
            
            // Empty string is null
            
            for (const fn in data) {
                if (data[fn] == "") {
                    data[fn] = null;
                }
            }
    
            // If trade items: Create product as well if not already existing
            
            if (metadata.resourceName == 'globalTradeItems') {
              
                let response = await ims.post("products", data);
                if (response.status == 422) {
                    if (response.data.messageCode != "duplicate_Product") {
                        error(ims, metadata.eventId, response.data, metadata.lineNumber);
                    }
                }
                
                let dimensions = new Object();
                let productVariantKey = new Object();
                for (const qfn in data) {
                    let tokens = qfn.split(".");
                    if (tokens.length == 2) {
                        let fn = tokens[1];
                        if (tokens[0] == 'productVariantKey') {
                            productVariantKey[fn] = data[qfn];
                        } else if (tokens[0] == 'dimensions') {
                            dimensions[fn] = data[qfn];
                        }
                        delete data[qfn];
                    }
                } 
                data.productVariantKey = productVariantKey;
                data.dimensions = dimensions;
                
            }
            
            // If shipment lines: Create shipment as well if not already existing
            
            if (metadata.resourceName == 'shipmentLines') {
                
                let deliveryAddress = new Object();
                let contactPerson = new Object();
                for (const qfn in data) {
                    let tokens = qfn.split(".");
                    if (tokens.length == 2) {
                        let fn = tokens[1];
                        if (tokens[0] == 'deliveryAddress') {
                            deliveryAddress[fn] = data[qfn];
                        } else if (tokens[0] == 'contactPerson') {
                            contactPerson[fn] = data[qfn];
                        }
                        delete data[qfn];
                    }
                } 
                data.deliveryAddress = deliveryAddress;
                data.contactPerson = contactPerson;
    
                let response = await ims.post("shipments", data);
                if (response.status == 422) {
                    if (response.data.messageCode != "duplicate_Shipment") {
                        error(ims, metadata.eventId, response.data, metadata.lineNumber);
                    }
                }
            }
    
            // If inbound shipment lines: Create inbouns shipment as well if not already existing
            
            if (metadata.resourceName == 'inboundShipmentLines') {
                let inboundShipment = new Object();
                inboundShipment.inboundShipmentNumber = data.inboundShipmentNumber;
                inboundShipment.supplierNumber = data.supplierNumber;
                let response = await ims.post("inboundShipments", inboundShipment);
                if (response.status == 422) {
                    if (response.data.messageCode != "duplicate_InboundShipment") {
                        error(ims, metadata.eventId, response.data, metadata.lineNumber);
                    }
                }
            }
            
            let response = await ims.post(metadata.resourceName, data);
            if (response.status == 422) {
                error(ims, metadata.eventId, response.data, metadata.lineNumber);
            }
           
        }
    }
    
}
