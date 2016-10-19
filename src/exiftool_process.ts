import * as _fs from 'fs'
import * as _cp from 'child_process'
import * as _process from 'process'
import * as _path from 'path'
import { Metadata } from './exiftool'

const isWin32 = process.platform === 'win32'
const exiftoolPath = require(`exiftool-vendored.${isWin32 ? 'exe' : 'pl'}`)

if (!_fs.existsSync(exiftoolPath)) {
  throw new Error(`Vendored ExifTool does not exist at ${exiftoolPath}`)
}

interface OutputReader<T> {
  (input: string): T
}

const StringReader: OutputReader<string> = (input) => input.trim()

const MetadataReader: OutputReader<Metadata> = (input) => {
  // TODO: Handle GPS coords and dates properly
  return JSON.parse(input)
}

class DeferredReader<T> {
  readonly promise: Promise<T>
  private warnings: string[] = []
  private _resolve: (value?: T) => void
  private _reject: (reason?: any) => void

  constructor(readonly reader: OutputReader<T>) {
    this.promise = new Promise<T>((resolve, reject) => {
      this._resolve = resolve
      this._reject = reject
    })
  }

  reject(reason?: any) {
    this._reject(reason)
  }

  addWarning(warning: string) {
    this.warnings.push(warning)
  }

  apply(input: string) {
    const result = this.reader(input)
    if (this.warnings.length > 0) {
      if (typeof result === 'object') {
        (result as any)['warnings'] = this.warnings
      } else {
        console.dir(this.warnings)
      }
    }
    this._resolve(result)
  }
}

/**
 * Manages a child process. Callers need to restart if ended.
 */
export class ExifToolProcess {
  private static readonly ready = '{ready}'
  private _ended = false
  private readonly proc: _cp.ChildProcess
  private buff = ''
  private readers: DeferredReader<any>[] = []
  private readonly versionPromise: Promise<string>

  constructor() {
    this.proc = _cp.spawn(
      exiftoolPath,
      ['-stay_open', 'True', '-@', '-']
    )
    this.proc.stdout.on('data', d => this.onData(d))
    this.proc.stderr.on('data', d => this.onError(d))
    this.proc.on('close', (code: any) => {
      console.log(`ExifTool exited with code ${code}`)
      for (const reader of this.readers) { reader.reject('ExifTool closed') }
      // TODO: Cancel all pending promises?
      this._ended = true
    })
    this.versionPromise = this.execute(StringReader, '-ver')
    _process.on('beforeExit', () => this.end())
  }

  get version(): Promise<string> {
    return this.versionPromise
  }

  read(file: string): Promise<Metadata> {
    const absPathToFile = _path.resolve(file)
    return this.execute(
      MetadataReader,
      '-json',
      '-coordFormat "%.8f"',
      '-fast',
      absPathToFile
    )
  }

  private end(): void {
    this.proc.stdin.write('\n-stay_open\nFalse\n')
    this.proc.stdin.end()
  }

  get ended(): boolean {
    return this._ended
  }

  private execute<T>(reader: OutputReader<T>, ...cmds: string[]): Promise<T> {
    const deferredReader = new DeferredReader(reader)
    this.readers.push(deferredReader)
    this.proc.stdin.write([...cmds,
      '-execute',
      '' // Need to end -execute with a newline
    ].join('\n'))
    return deferredReader.promise
  }

  private onError(error: string | Buffer) {
    if (this.readers.length === 0) {
      console.error(`Error from ExifTool without any readers: ${error}`)
    } else {
      this.readers[0].addWarning(error.toString())
    }
  }

  private onData(data: string | Buffer) {
    this.buff = (this.buff + data.toString()).trim()
    const done = this.buff.endsWith(ExifToolProcess.ready)
    if (done) {
      const buff = this.buff.slice(0, -ExifToolProcess.ready.length)
      this.buff = ''
      const reader = this.readers.shift()
      if (reader) {
        reader.apply(buff)
      } else {
        console.error(`No reader for payload ${buff}`)
      }
    }
  }
}