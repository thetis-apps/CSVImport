# Introduction

This application listen for attachment of files. In Thetis IMS you can attach files to any piece of master data and to some pieces of transactional data as well. So, you can for instance attach files to your individual customers. When an attachment is made, an event is put on the event bus. The event object holds the piece of data the file was attached to - in this example the customer - and a URL to the file that was attached. You can read more about the event bus and the 'fileAttached' event in our integration manual.

When a file is attached, the application will - if the file meets certain criterias - parse it as a CSV file and create new data in Thetis IMS based on the content of the file.

# Third party modules

This application uses the 'csv-parser' module.

https://www.npmjs.com/package/csv-parser

Files with extentions xls or xlsx are automatically converted to csv. The application uses the 'xlsx' module for that purpose.

Byte order marks are automatically removed thanks to the 'strip-bom-stream' module.

Character set decoding is done with the 'iconv-lite' module.

# Configuration

Context data document:

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

#### options

Options described here: https://www.npmjs.com/package/csv-parser

#### encoding

The encoding of the file.

#### fileNamePattern

The application will only process files that have a name that matches this regular expression. 

#### enrichment

Possible to include values from fields of the entity the file was attached to.

#### entityName

The name of the entity that the file has been attached to.

#### resourceName

The name of the resource that the file contains records for.

#### encoding

The assummed encoding of the attached file.