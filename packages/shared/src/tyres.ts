/** Compuestos de neumático de los coches de la lista del servidor (para elegir los permitidos). */
export interface CarTyresDto {
  /** Coches de la lista del servidor con sus compuestos. `tyres` vacío = no se pudieron leer (contenido no encontrado). */
  cars: { id: string; name: string; tyres: { short: string; name: string }[] }[];
}
