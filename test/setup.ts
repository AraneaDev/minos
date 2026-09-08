// Times are rendered in the machine's local zone, so an assertion on a
// rendered clock value would otherwise pass in Amsterdam and fail in CI. Every
// test file starts from UTC; the ones that are specifically about local
// rendering set their own TZ and restore it.
process.env.TZ = 'UTC'
