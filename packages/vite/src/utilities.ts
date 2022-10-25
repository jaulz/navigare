import { PhpFinderOptions } from './types'
import c from 'chalk'
import * as execa from 'execa'
import { loadEnv } from 'vite'

export function parseUrl(href?: string) {
  if (!href) {
    return null
  }

  try {
    return new URL(href)
  } catch {
    return null
  }
}

export function finish(
  str: string | undefined,
  character: string,
  _default: string = '',
): string {
  if (!str) {
    return _default
  }

  if (!str.endsWith(character)) {
    return str + character
  }

  return str
}

export function wrap<T>(input: undefined | T | T[], _default: T[]): T[] {
  if (!input) {
    return _default
  }

  if (Array.isArray(input)) {
    return input
  }

  return [input]
}

/**
 * Finds the path to PHP.
 */
export function findPhpPath(options: PhpFinderOptions = {}): string {
  if (options.path) {
    return options.path
  }

  if (!options.env) {
    options.env = loadEnv(
      options.mode ?? process.env.NODE_ENV ?? 'development',
      process.cwd(),
      '',
    )
  }

  return options.env.PHP_EXECUTABLE_PATH || 'php'
}

/**
 * Calls an artisan command.
 */
export function callArtisan(executable: string, ...params: string[]): string {
  if (process.env.VITEST && process.env.TEST_ARTISAN_SCRIPT) {
    console.log(process.env.TEST_ARTISAN_SCRIPT)
    return execa.sync(
      process.env.TEST_ARTISAN_SCRIPT,
      [executable, 'artisan', ...params],
      { encoding: 'utf-8' },
    )?.stdout
  }

  return execa.sync(executable, ['artisan', ...params])?.stdout
}

/**
 * Calls a shell command.
 */
export function callShell(executable: string, ...params: string[]): string {
  if (process.env.VITEST && process.env.TEST_ARTISAN_SCRIPT) {
    return execa.sync(process.env.TEST_ARTISAN_SCRIPT, [executable, ...params])
      ?.stdout
  }

  return execa.sync(executable, [...params])?.stdout
}

/**
 * Prints a warn message.
 */
export function warn(prefix: string, message: string, ...args: any[]) {
  console.warn(c.yellow.bold(`(!) ${c.cyan(prefix)} ${message}`, ...args))
}
