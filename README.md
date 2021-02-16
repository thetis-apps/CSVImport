# Introduction

Wraps csv-parser.

https://www.npmjs.com/package/csv-parser

Files with extentions xls or xlsx are automatically converted to csv.



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