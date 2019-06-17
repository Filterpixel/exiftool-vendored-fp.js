import * as _path from "path"

import { isDateOrTime, toExifString } from "./DateTime"
import { WriteTags } from "./ExifTool"
import { ExifToolTask } from "./ExifToolTask"
import { Maybe } from "./Maybe"
import { isNumber } from "./Number"
import { keys } from "./Object"
import { htmlEncode, isString } from "./String"
import { isStruct } from "./Struct"

const successRE = /1 image files? updated/

// See https://sno.phy.queensu.ca/%7Ephil/exiftool/faq.html#Q10
// (`-charset utf8` is set by default)
const utfCharsetArgs = [
  "-charset",
  "filename=utf8",
  "-codedcharacterset=utf8",
  "-struct",
  "-E" // < html encoding https://sno.phy.queensu.ca/~phil/exiftool/faq.html#Q10
]

function enc(o: any): Maybe<string> {
  if (o == null) {
    return ""
  } else if (isNumber(o)) {
    return String(o)
  } else if (isString(o)) {
    return htmlEncode(String(o))
  } else if (isDateOrTime(o)) {
    return toExifString(o)
  } else if (Array.isArray(o)) {
    return `[${o.map(enc).join(",")}]`
  } else if (isStruct(o)) {
    return `{${keys(o)
      .map(k => enc(k) + " = " + enc(o[k]))
      .join(",")}}`
  } else {
    throw new Error("cannot encode " + JSON.stringify(o))
  }
}

export class WriteTask extends ExifToolTask<void> {
  private constructor(readonly sourceFile: string, readonly args: string[]) {
    super(args)
  }

  static for(
    filename: string,
    tags: WriteTags,
    optionalArgs: string[] = []
  ): WriteTask {
    const sourceFile = _path.resolve(filename)

    const args: string[] = [...utfCharsetArgs]

    keys(tags).forEach(key => {
      const val = tags[key]
      const arr: any[] = Array.isArray(val) ? val : [val]
      arr.forEach(ea => args.push(`-${key}=${enc(ea)}`))
    })

    optionalArgs.forEach(ea => args.push(ea))
    args.push(sourceFile)
    return new WriteTask(sourceFile, args)
  }

  toString(): string {
    return "WriteTask(" + this.sourceFile + ")"
  }

  protected parse(data: string, err: Error): void {
    if (err != null) throw err
    if (this.errors.length > 0) throw new Error(this.errors.join(";"))
    data = data.trim()
    if (successRE.exec(data) != null) {
      return
    } else {
      throw new Error("No success message: " + data)
    }
  }
}
