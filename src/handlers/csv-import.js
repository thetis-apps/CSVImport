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

const parse = (inputStream, fileset) => {
    return new Promise((resolve, reject) => {
            let results = [];
            inputStream.pipe(stripBom()).pipe(iconv.decodeStream(fileset.encoding)).pipe(csvParser(fileset.options))
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
 * A Lambda function that handles a file attached to a piece of master data.
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
    let setup = dataDocument.CSVImport;
    
    // Find a matching pattern

    let filesets = setup;
    let patterns = [];
    let found = false;
    let entityNameFound = false;
    let i = 0;
    while (i < filesets.length && !found) {
        let fileset = filesets[i];
        if (entityName == fileset.entityName) {
            patterns.push(fileset.fileNamePattern);
            entityNameFound = true;
            if (fileName.match(fileset.fileNamePattern)) {
                found = true;
            } else {
                i++;
            }
        } else {
            i++;
        }
    }
    
    // If file name does not match a fileset we just return. If there are filesets defined for the entity we send a message.
    
    if (!found) {
        if (entityNameFound) {
            let message = new Object();
        	message.time = Date.now();
        	message.source = "CSVImport";
        	message.messageType = 'WARNING';
        	message.messageText = 'File not imported as CSV because its name does not match any of the filesets defined. The filesets defined are: ' + patterns.toString();
        	message.userId = detail.userId;
        	message.deviceName = detail.deviceName;
        	await ims.post("events/" + detail.eventId + "/messages", message);
        }
        return "SKIP";
    }

    let fileset = filesets[i];
    let options = fileset.options;
    let resourceName = fileset.resourceName;
    
    let numWriters = fileset.numWriters;
    if (numWriters === undefined) {
        numWriters = 1;
    }

    console.log('Options: ' + JSON.stringify(options));

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
    
    let results = await parse(stream, fileset);  
    
    console.log("Got result " + JSON.stringify(results));

    // For each line in the file
    
    let chunk = [];
    for (let i = 0; i < results.length; i++) {
        
        let data = results[i];
        
        // Remove fields that were not mapped
        
        for (let fieldName in data) {
            if (fieldName.startsWith('_')) {
                delete data[fieldName];
            }
        }
        
        // Enrich line with metadata
        
        let metadata = new Object();
        metadata.lineNumber = i;
        metadata.numLines = results.length;
        metadata.resourceName = resourceName;
        metadata.fileName = fileName;
        metadata.eventId = detail.eventId;
        metadata.deviceName = detail.deviceName;
        metadata.userId = detail.userId;
        data.metadata = metadata;       
        
        // Further enrichment
        
        if (typeof fileset.enrichment !== 'undefined') {
            for (let fn in fileset.enrichment) {
                let value = fileset.enrichment[fn];
                if (typeof value === 'string' && value.startsWith("$")) {
                    value = detail.data[value.substring(1)];   
                } else {
                    value = fileset.enrichment[fn];
                }
                data[fn] = value;
            }
        }
        
        chunk.push(data);
        
        await sendSqs(chunk, (i % numWriters).toString(), event.id + '#' + i.toString());
        
        chunk = [];
        
    }
    
    // Send remainder 
    
    if (chunk.length > 0) {
        await sendSqs(chunk, (i % numWriters).toString(), event.id + '#' + i.toString());
    }

    // Let the user know that import has started

    let message = new Object();
	message.time = Date.now();
	message.source = "CSVImport";
	message.messageType = 'INFO';
	message.messageText = "Started importing " + results.length + " lines from the attached file " + fileName;
	message.userId = detail.userId;
	message.deviceName = detail.deviceName;
	await ims.post("events/" + detail.eventId + "/messages", message);

};

async function preInsert(ims, metadata, data) {
    
    // If inbound shipment line: Create inbound shipment

    if (metadata.resourceName == 'inboundShipmentLines' && data.hasOwnProperty('supplierNumber')) {
        let response = await ims.post("inboundShipments", data);
        if (response.status == 422) {
            if (response.data.messageCode != "duplicate_InboundShipment") {
                await error(ims, metadata.eventId, metadata.userId, metadata.deviceName, response.data, metadata.lineNumber);
            }
        }
    }
    
    // If inbound shipment line: Do lookup item on GTIN if no SKU present
    
    if (metadata.resourceName == 'inboundShipmentLines' && !data.hasOwnProperty('stockKeepingUnit') && data.hasOwnProperty('globalTradeItemNumber')) {
        let response = await ims.get("globalTradeItems", { params: { globalTradeItemNumberMatch: data.globalTradeItemNumber }});
        if (response.status == 422) {
            await error(ims, metadata.eventId, metadata.userId, metadata.deviceName, response.data, metadata.lineNumber);
        } else {
            let items = response.data;
            if (items.length > 0) {
                let item = items[0];
                data.globalTradeItemId = item.id;
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
    
}

async function postInsert(ims, metadata, data) {
    
    // If item lot: Do a stock taking
    
    if (metadata.resourceName == 'globalTradeItemLots') {
        if (data.hasOwnProperty('numItems')) {
            let response = await ims.post('invocations/countGlobalTradeItemLot', { numItemsCounted: data.numItems, globalTradeItemLotId: data.id, discrepancyCause: 'TRANSFERRED' });
            if (response.status == 422) {
                await error(ims, metadata.eventId, metadata.userId, metadata.deviceName, response.data, metadata.lineNumber);
            }                        
        }
    }
    
}

async function insert(ims, metadata, data) {
    await preInsert(ims, metadata, data);
    let response = await ims.post(metadata.resourceName, data);
    if (response.status == 422) {
        await error(ims, metadata.eventId, metadata.userId, metadata.deviceName, response.data, metadata.lineNumber);
    } else {
        let result = response.data;
        await postInsert(ims, metadata, result);
    }
}

async function update(ims, metadata, id, data) {
    delete data.contextLocalKey;
    let response = await ims.patch(metadata.resourceName + '/' + id, data);
    if (response.status == 422) {
        await error(ims, metadata.eventId, metadata.userId, metadata.deviceName, response.data, metadata.lineNumber);
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

            if (data.contextLocalKey != null) {
                let response = await ims.get(metadata.resourceName, { params: { contextLocalKey: data.contextLocalKey }});
                let result = response.data;
                if (result.length == 0) {
                    await insert(ims, metadata, data);
                } else {
                    let dto = result[0];
                    await update(ims, metadata, dto.id, data);
                }
            } else {
                await insert(ims, metadata, data);
            }
            
            if (metadata.lineNumber == metadata.numLines - 1) {
                let message = new Object();
            	message.time = Date.now();
            	message.source = "CSVImport";
            	message.messageType = 'INFO';
            	message.messageText = "Finished importing last line out of " + metadata.numLines + " lines from the attached file " + metadata.fileName;
            	message.userId = metadata.userId;
            	message.deviceName = metadata.deviceName;
            	await ims.post("events/" + metadata.eventId + "/messages", message);
            }

        }
    }
    
};
