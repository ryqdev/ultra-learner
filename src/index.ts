export function greet(name = "world"): string {
  return `Hello, ${name}!`;
}

if (import.meta.main) {
  console.log(greet(process.argv[2]));
}
