# Introduction

Wraps csv-parser.

https://www.npmjs.com/package/csv-parser

Files with extentions xls or xlsx are automatically converted to csv.

# Installation

You can install this application from the Serverless Application Repository. The application is registered under the name thetis-ims-csv-import.

## Parameters

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

#### encoding

The encoding of the file.

#### fileNamePattern

Files that have a name that matches this regular expression belongs to this fileset. 

#### enrichment

This map contains corresponding values of field name and value. The value may either be expressed as a constant or as a reference to a field in the entity that the file was attached to. 

#### entityName

The name of the entity that the file has been attached to.

#### resourceName

The name of the resource that the file contains records for.


