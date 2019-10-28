import * as exec from '@actions/exec'
import signale from 'signale'

export default async function(deployId: string, token: string, cb: (err: string, output: string) => any) {
  let myOutput = ''
  let myError = ''

  signale.debug('Getting build logs from now...')

  const options: any = {}
  options.listeners = {
    stdout: (data: Buffer) => {
      myOutput += data.toString()
    },
    stderr: (data: Buffer) => {
      myError += data.toString()
    },
  }
  options.cwd = process.cwd()

  await exec.exec('npm', ['run', 'logs', deployId, '--token=' + token], options)

  signale.success('Done for logs.')
  return cb(myError, myOutput)
}
