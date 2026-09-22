export function membresiaParaNuevaFicha({ organization }) {
    return { membresiaClub: organization.membresiaPropia, nombreClub: null };
}
