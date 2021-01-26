const axios = require('axios');

const csvParser = require('csv-parser');

var AWS = require('aws-sdk');
AWS.config.update({region:'eu-west-1'});

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
    		headers: { "Authorization": token, "x-api-key": apiKey, "Content-Type": "application/json" }
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

const parse = (inputStream, options) => {
    return new Promise((resolve, reject) => {
            let results = [];
            inputStream.pipe(csvParser(options))
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


/**
 * A Lambda function that logs the payload received from a CloudWatch scheduled event.
 */
exports.fileAttachedEventHandler = async (event, context) => {
    
    let detail = event.detail;
    let presignedUrl = detail.url;
    
    let resourceName = detail.data.resourceName;
    
    let dataDocument = JSON.parse(detail.data.dataDocument);
    
    let options = dataDocument.CSVImport;

    console.log(JSON.stringify(options));

    let ims = await getIMS();

    console.log("Got IMS");

    let response = await axios.get(presignedUrl, { responseType: 'stream' });
    
    console.log("Got stream");
    
    let results = await parse(response.data, options);  
    
    console.log("Got result " + JSON.stringify(results));
    
    for (let i = 0; i < results.length; i++) {
        let data = results[i];
        await ims.post(resourceName, data);
    }

}
