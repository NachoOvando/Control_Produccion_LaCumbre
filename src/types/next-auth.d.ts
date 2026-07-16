import "next-auth"

declare module "next-auth" {
  interface User {
    rol: string
  }
  interface Session {
    user: {
      id: string
      email: string
      name: string
      rol: string
    }
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string
    rol: string
  }
}
