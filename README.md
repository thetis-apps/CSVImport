# Introduction

Wraps csv-parser.

https://www.npmjs.com/package/csv-parser

# Configuration

Metadata data document:

```
{
  "CSVImport": [
    {
      "options": {
        "headers": [
          "productNumber",
          "productName"
        ],
        "skipLines": 1
      },
      "encoding": "UTF-8",
      "fileNamePattern": "Items.*\\.csv"
    },
    {
      "options": {
        "separator": ";"
      },
      "encoding": "ISO-8859-1",
      "fileNamePattern": "Varer.*\\.csv"
    }
  ]
}
```

Options described here: https://www.npmjs.com/package/csv-parser

#### encoding

The encoding of the file.

#### fileNamePattern

The application will only process files that have a name that matches this regular expression. 

