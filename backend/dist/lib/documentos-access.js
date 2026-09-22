export function puedeVerDocumentos({ isAdmin, integranteMembresiaClub, membresiaPropia, }) {
    return isAdmin || integranteMembresiaClub === membresiaPropia;
}
