# Introduction

This application listen for attachment of files. In Thetis IMS you can attach files to any piece of master data and to some pieces of transactional data as well. So, you can for instance attach files to your individual customers. When an attachment is made, an event is put on the event bus. The event object holds the piece of data the file was attached to - in this example the customer - and a URL to the file that was attached. You can read more about the event bus and the 'fileAttached' event in our integration manual.

When a file is attached, the application will - if the file meets certain criterias - parse it as a CSV file and create new data in Thetis IMS based on the content of the file.

# Installation

You can install this application from the Serverless Application Repository. The application is registered under the name thetis-ims-csv-import.

## Parameters

When installing the application you must provide a few parameters.

#### ContextId

The unique numerical identification of the context (area) within which this instance of the application should listen for events.

#### ApiKey

The key that gives access to the context within Thetis IMS.

#### ClientId

The name of a parameter in the Parameter Store of your AWS account that has your Thetis IMS client id as its value. The default name of the parameter is 'ThetisClientId', and we generally recommend using this name.

#### ClientSecret

The name of a parameter in the Parameter Store of your AWS account that has your Thetis IMS client secret as its value. The default name of the parameter is 'ThetisClientSecret', and we generally recommend using this name.

#### DevOpsMail

The address to mail when the processing of an event fails.

# Configuration

You configure the application through the data document of the context. Here is what a configuration may look like:

```
{
  "CSVImport": [
    {
      "options": {
        "headers": [
          "filler",
          "locationNumber",
          "filler"
        ],
        "separator": ";",
        "skipLines": 1
      },
      "encoding": "UTF-8",
      "enrichment": {
        "locationType": "RACK"
      },
      "entityName": "Context",
      "resourceName": "locations",
      "fileNamePattern": ".*\\.csv"
    },
    {
      "options": {
        "headers": [
          "filler",
          "filler",
          "numItemsExpected",
          "purchasePrice",
          "filler",
          "stockKeepingUnit"
        ],
        "separator": ",",
        "skipLines": 1
      },
      "encoding": "UTF-8",
      "enrichment": {
        "inboundShipmentNumber": "$inboundShipmentNumber"
      },
      "entityName": "InboundShipment",
      "resourceName": "inboundShipmentLines",
      "fileNamePattern": ".*\\.xls"
    }
  ]
}
```

The configuration consists of an array of objects. Each object describes a set of files and how to handle them.

## Fileset configuration

#### options

These are the options that are passed on to the csv-parser. They are described here: https://www.npmjs.com/package/csv-parser.

In the header element you may refer to attributes of the resource indicated in the resourceName field. You can find these fields in the data catalogue: https://data.thetis-ims.com/en.

#### encoding

The encoding of the file.

#### fileNamePattern

Files that have a name that matches this regular expression belongs to this fileset. 

#### enrichment

This map contains corresponding values of field name and value. The value may either be expressed as a constant or as a reference to a field in the entity that the file was attached to. To make a reference to a field in the entity the file was attached to write the name of the field with a dollar sign prefixed.

#### entityName

The name of the entity that the file has been attached to.

#### resourceName

The name of the resource that the file contains records for. 

# Special handling of trade items

If the resourceName is equal to 'globalTradeItems', the application will check if a field by the name 'productGroupName' is present. If that is the case, the application will use the data from the line to create a product before creating the trade item. No message is attached to the file, if the product already exists.

# Special handling of inbound shipment lines

If the resourceName is equal to 'inboundShipmentLines', the application will check if a field by the name 'supplierNumber' is present. If that is the case, the application  will use the data from the line to create an inbound shipment before creating the inbound shipment line. No message is attached to the file, if the inbound shipment already exists.

# Special handling of item lots

If the resourceName is equal to 'globalTradeItemLots', the application will check if a field by the name 'numItems' is present. If that is the case, the application will do a count of the newly created item lot. 

# Error handling

If the processing of an event fails for an unforeseen reason, the event object is moved to the dead letter queue and an email is sent to the address provided on installation.

If the processing of a line fails, a message is attached to the file. You may view these messages from the Thetis IMS application. A line will for instance fail, if a record with the same key alreade exists.

# Third party modules

Files are parsed using the 'csv-parser' module.

Files with extentions xls or xlsx are automatically converted to csv. The application uses the 'xlsx' module for that purpose.

Character set decoding is done with the 'iconv-lite' module.

Byte order marks are automatically removed thanks to the 'strip-bom-stream' module.

