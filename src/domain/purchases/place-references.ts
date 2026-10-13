/** Directorio de arranque: referencias públicas contrastables.
 * NO es lectura en vivo de Places; el usuario debe confirmar aperturas especiales. */
export type PlaceMatch={
 placeId:string;name:string;address:string;postal:string;
 opening:string;closing:string;openDays:string;mapsUrl:string;
 source:"DIRECTORIO"|"GOOGLE_PLACES";hoursNote:string;
};
export const referencePlaces:PlaceMatch[]=[
 {placeId:"ChIJ56IqRIPAz4URjOHsnBdww5E",name:"Sam's Club La Noria",
 address:"Circuito Juan Pablo II 1920, Reserva Territorial Atlixcáyotl, La Noria, 72410 Puebla, Pue., México",
 postal:"72410",opening:"08:00",closing:"22:00",openDays:"0123456",
 mapsUrl:"https://www.google.com/maps/search/?api=1&query="+encodeURIComponent("Sam's Club La Noria Puebla")+"&query_place_id=ChIJ56IqRIPAz4URjOHsnBdww5E",
 source:"DIRECTORIO",hoursNote:"Referencia de listado público: 08:00–22:00. Otro directorio reporta 07:00; confirmar apertura con sucursal."},
 {placeId:"ChIJrX_qGiTHz4URhIEMRPTKfpc",name:"Walmart Las Ánimas",
 address:"Blvd. Atlixco 3304, Nueva Antequera, 72180 Puebla, Pue., México",
 postal:"72180",opening:"08:00",closing:"22:00",openDays:"0123456",
 mapsUrl:"https://www.google.com/maps/search/?api=1&query="+encodeURIComponent("Walmart Las Ánimas Puebla")+"&query_place_id=ChIJrX_qGiTHz4URhIEMRPTKfpc",
 source:"DIRECTORIO",hoursNote:"Horario publicado de referencia: 08:00–22:00, sujeto a modificaciones por día festivo."},
 {placeId:"ChIJ5_EwUMLGz4URC_bDMI8K7vg",name:"Walmart Reforma",
 address:"Prolongación Reforma Sur 3117, Plaza Reforma, 72160 Puebla, Pue., México",
 postal:"72160",opening:"08:00",closing:"22:00",openDays:"0123456",
 mapsUrl:"https://www.google.com/maps/search/?api=1&query="+encodeURIComponent("Walmart Reforma Puebla")+"&query_place_id=ChIJ5_EwUMLGz4URC_bDMI8K7vg",
 source:"DIRECTORIO",hoursNote:"Horario publicado de referencia: 08:00–22:00, sujeto a modificaciones por día festivo."}
];
export function referencePlaceSearch(query:string):PlaceMatch[]{
 const terms=query.toLocaleLowerCase("es-MX").split(/\s+/).filter(x=>x.length>1);
 if(!terms.length)return referencePlaces;
 return referencePlaces.filter(p=>{
  const fields=(p.name+" "+p.postal+" "+p.address).toLocaleLowerCase("es-MX");
  return terms.every(t=>fields.includes(t));
 });
}
