use aztec::{
    macros::notes::note,
    note::{note_getter::view_notes, note_viewer_options::NoteViewerOptions},
    protocol::{address::{AztecAddress, EthAddress}, traits::{Deserialize, Packable, Serialize}},
};

/// The Ethereum address a user account is bound to: its first private claim's depositor, and the only L1 recipient its
/// withdrawals may name.
#[derive(Deserialize, Eq, Packable, Serialize)]
#[note]
pub struct FundingAddressNote {
    pub address: EthAddress,
}

/// `owner`'s funding address, if this PXE holds the binding note stored at `slot`. Unconstrained: a hint, never a proof.
pub unconstrained fn funding_note(owner: AztecAddress, slot: Field) -> Option<EthAddress> {
    let notes = view_notes(slot, NoteViewerOptions::<FundingAddressNote, _>::new().set_owner(owner));
    if notes.len() == 0 {
        Option::none()
    } else {
        Option::some(notes.get(0).address)
    }
}
