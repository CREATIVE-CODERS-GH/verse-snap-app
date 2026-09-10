/**
 * Sample KJV text used while the live Bible provider is being wired up.
 * Keyed by `${bookId}.${chapter}` with a sparse map of verse number -> text.
 */
export const SAMPLE_KJV: Record<string, Record<number, string>> = {
  "genesis.1": {
    1: "In the beginning God created the heaven and the earth.",
    2: "And the earth was without form, and void; and darkness was upon the face of the deep. And the Spirit of God moved upon the face of the waters.",
    3: "And God said, Let there be light: and there was light.",
  },
  "psalms.23": {
    1: "The LORD is my shepherd; I shall not want.",
    2: "He maketh me to lie down in green pastures: he leadeth me beside the still waters.",
    3: "He restoreth my soul: he leadeth me in the paths of righteousness for his name's sake.",
    4: "Yea, though I walk through the valley of the shadow of death, I will fear no evil: for thou art with me; thy rod and thy staff they comfort me.",
    5: "Thou preparest a table before me in the presence of mine enemies: thou anointest my head with oil; my cup runneth over.",
    6: "Surely goodness and mercy shall follow me all the days of my life: and I will dwell in the house of the LORD for ever.",
  },
  "proverbs.3": {
    5: "Trust in the LORD with all thine heart; and lean not unto thine own understanding.",
    6: "In all thy ways acknowledge him, and he shall direct thy paths.",
  },
  "isaiah.41": {
    10: "Fear thou not; for I am with thee: be not dismayed; for I am thy God: I will strengthen thee; yea, I will help thee; yea, I will uphold thee with the right hand of my righteousness.",
  },
  "jeremiah.29": {
    11: "For I know the thoughts that I think toward you, saith the LORD, thoughts of peace, and not of evil, to give you an expected end.",
    12: "Then shall ye call upon me, and ye shall go and pray unto me, and I will hearken unto you.",
    13: "And ye shall seek me, and find me, when ye shall search for me with all your heart.",
  },
  "matthew.11": {
    28: "Come unto me, all ye that labour and are heavy laden, and I will give you rest.",
    29: "Take my yoke upon you, and learn of me; for I am meek and lowly in heart: and ye shall find rest unto your souls.",
    30: "For my yoke is easy, and my burden is light.",
  },
  "john.3": {
    14: "And as Moses lifted up the serpent in the wilderness, even so must the Son of man be lifted up:",
    15: "That whosoever believeth in him should not perish, but have eternal life.",
    16: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.",
    17: "For God sent not his Son into the world to condemn the world; but that the world through him might be saved.",
    18: "He that believeth on him is not condemned: but he that believeth not is condemned already, because he hath not believed in the name of the only begotten Son of God.",
  },
  "romans.8": {
    26: "Likewise the Spirit also helpeth our infirmities: for we know not what we should pray for as we ought: but the Spirit itself maketh intercession for us with groanings which cannot be uttered.",
    27: "And he that searcheth the hearts knoweth what is the mind of the Spirit, because he maketh intercession for the saints according to the will of God.",
    28: "And we know that all things work together for good to them that love God, to them who are the called according to his purpose.",
    29: "For whom he did foreknow, he also did predestinate to be conformed to the image of his Son, that he might be the firstborn among many brethren.",
    31: "What shall we then say to these things? If God be for us, who can be against us?",
  },
  "1corinthians.13": {
    4: "Charity suffereth long, and is kind; charity envieth not; charity vaunteth not itself, is not puffed up,",
    5: "Doth not behave itself unseemly, seeketh not her own, is not easily provoked, thinketh no evil;",
    6: "Rejoiceth not in iniquity, but rejoiceth in the truth;",
    7: "Beareth all things, believeth all things, hopeth all things, endureth all things.",
  },
  "philippians.4": {
    6: "Be careful for nothing; but in every thing by prayer and supplication with thanksgiving let your requests be made known unto God.",
    7: "And the peace of God, which passeth all understanding, shall keep your hearts and minds through Christ Jesus.",
    13: "I can do all things through Christ which strengtheneth me.",
  },
  "hebrews.2": {
    4: "God also bearing them witness, both with signs and wonders, and with divers miracles, and gifts of the Holy Ghost, according to his own will?",
    5: "For unto the angels hath he not put in subjection the world to come, whereof we speak.",
    6: "But one in a certain place testified, saying, What is man, that thou art mindful of him? or the son of man, that thou visitest him?",
    7: "Thou madest him a little lower than the angels; thou crownedst him with glory and honour, and didst set him over the works of thy hands:",
  },
  "james.1": {
    5: "If any of you lack wisdom, let him ask of God, that giveth to all men liberally, and upbraideth not; and it shall be given him.",
  },
};
