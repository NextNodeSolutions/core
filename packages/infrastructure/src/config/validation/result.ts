type Ok<T> = { readonly ok: true; readonly section: T }
type Err = { readonly ok: false; readonly errors: string[] }
export type ValidationResult<T> = Ok<T> | Err
