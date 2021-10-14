const axios = require('axios');

const csvParser = require('csv-parser');

const stripBom = require('strip-bom-stream');

var iconv = require('iconv-lite');

var XLSX = require('xlsx');

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

async function error(ims, eventId, userId, deviceName, data, lineNumber) {
	let message = new Object();
	message.time = Date.now();
	message.source = "CSVImport";
	message.messageType = data.messageType;
	message.messageText = "Line " + lineNumber + ": " + data.messageText;
	message.userId = userId;
	message.deviceName = deviceName;
	await ims.post("events/" + eventId + "/messages", message);
}

async function sendSqs(chunk, group, id) {
    var params = {
        MessageBody: JSON.stringify(chunk),
        QueueUrl: process.env.DispatchQueue,
        MessageGroupId: group,
        MessageDeduplicationId: id
    };
    await sqs.sendMessage(params).promise();
}

/**
 * A Lambda function that logs the payload received from a CloudWatch scheduled event.
 */
exports.fileAttachedEventHandler = async (event, x) => {
    
    let detail = event.detail;
    let presignedUrl = detail.url;
    let entityName = detail.entityName;
    let fileName = detail.fileName;
    
    let ims = await getIMS();
    
    let response = await ims.get("contexts/" + detail.contextId);
    let context = response.data;
    let dataDocument = JSON.parse(context.dataDocument);
    
    let setups = dataDocument.CSVImport;
    let found = false;
    let i = 0;
    while (i < setups.length && !found) {
        let setup = setups[i];
        if (entityName == setup.entityName && fileName.match(setup.fileNamePattern)) {
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
    let resourceName = setup.resourceName;

    console.log(JSON.stringify(options));

    // Create stream - either from converted XLSX file or directly from CSV file

    let stream;
    if (fileName.endsWith('xls') || fileName.endsWith('xlsx') ) {
        response = await axios.get(presignedUrl, { responseType: 'arraybuffer' });
        let workbook = XLSX.read(response.data, { type:"buffer" });
        let firstSheetName = workbook.SheetNames[0];
        let worksheet = workbook.Sheets[firstSheetName];
        stream = XLSX.stream.to_csv(worksheet);
    } else {
        response = await axios.get(presignedUrl, { responseType: 'stream' });
        stream = response.data;
    }
    
    console.log("Got stream");
    
    let results = await parse(stream, setup);  
    
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
        metadata.deviceName = detail.deviceName;
        metadata.userId = detail.userId;
        data.metadata = metadata;       
        
        // Further enrichment
        
        if (typeof setup.enrichment !== 'undefined') {
            for (let fn in setup.enrichment) {
                let value = setup.enrichment[fn];
                if (typeof value === 'string' && value.startsWith("$")) {
                    value = detail.data[value.substring(1)];   
                } else {
                    value = setup.enrichment[fn];
                }
                data[fn] = value;
            }
        }
        
        chunk.push(data);
        
        // One message for each line dispatched to 10 writers.
        
        await sendSqs(chunk, (i % 10).toString(), event.id + '#' + i.toString());
        
        chunk = [];
        
    }
    
    // Send remainder 
    
    if (chunk.length > 0) {
        await sendSqs(chunk, (i % 10).toString(), event.id + '#' + i.toString());
    }

}

exports.writer = async (event, x) => {

    console.log(JSON.stringify(event));
    
    let ims = await getIMS();

    // For each SQS message

    let records = event.Records;
    for (let i = 0; i < records.length; i++) {
        let record = records[i];
        
        // For each line read from a file
        
        let results = JSON.parse(record.body);
        for (let j = 0; j < results.length; j++) {
            let data = results[j];
            
            console.log(JSON.stringify(data));
    
            let metadata = data.metadata;
            
            // Empty string is null
            
            for (const fn in data) {
                if (data[fn] == "") {
                    data[fn] = null;
                }
            }
    
            // If inbound shipment line: Create inbound shipment
    
            if (metadata.resourceName == 'inboundShipmentLines' && data.hasOwnProperty('supplierNumber')) {
                let response = await ims.post("inboundShipments", data);
                if (response.status == 422) {
                    if (response.data.messageCode != "duplicate_InboundShipment") {
                        await error(ims, metadata.eventId, metadata.userId, metadata.deviceName, response.data, metadata.lineNumber);
                    }
                }
            }
            
            // If trade items: Create product as well if not already existing
            
            if (metadata.resourceName == 'globalTradeItems' && data.hasOwnProperty('productGroupName')) {
              
                let response = await ims.post("products", data);
                if (response.status == 422) {
                    if (response.data.messageCode != "duplicate_Product") {
                        await error(ims, metadata.eventId, metadata.userId, metadata.deviceName, response.data, metadata.lineNumber);
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
            
            // If shipments: Handle delivery address and contact person
            
            if (metadata.resourceName == 'shipments') {
                
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
    
            }
            
            let response = await ims.post(metadata.resourceName, data);
            if (response.status == 422) {
                await error(ims, metadata.eventId, metadata.userId, metadata.deviceName, response.data, metadata.lineNumber);
            } else {
           
                let result = response.data;
                
                // If item lot: Do a stock taking 
                
                if (metadata.resourceName == 'globalTradeItemLots') {
                    if (data.hasOwnProperty('numItems')) {
                        response = await ims.post('invocations/countGlobalTradeItemLot', { numItemsCounted: data.numItems, globalTradeItemLotId: result.id, discrepancyCause: 'TRANSFERRED' });
                        if (response.status == 422) {
                            await error(ims, metadata.eventId, metadata.userId, metadata.deviceName, response.data, metadata.lineNumber);
                        }                        
                    }
                }

            }

        }
    }
    
}
