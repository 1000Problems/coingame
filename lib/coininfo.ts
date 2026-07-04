// Coin card content (TASK-coingame-09). Editorial copy, versioned with code —
// deliberately NOT in the DB. Source: cripto.md research (2026-07-04).
// Excluded on purpose: real-world price-record facts (BNB >$1,000, DOGE ATH,
// HYPE ATH) — they contradict the deterministic fake tape on screen.
// Safe in client components: plain data, no imports.

export type CoinInfo = { intro: string; facts: string[] };

export const COIN_INFO: Record<string, CoinInfo> = {
  BTC: {
    intro:
      "Bitcoin is the world's first cryptocurrency — digital money you can send anywhere without banks, launched in 2009 by a mysterious figure named Satoshi Nakamoto. It runs on a global network of computers and is often called \"digital gold\" because only 21 million will ever exist.",
    facts: [
      "Bitcoin's creator, \"Satoshi Nakamoto,\" has never been identified and vanished from the internet around 2011.",
      "The very first Bitcoin block, mined January 3, 2009, hid a secret message quoting a Times headline about bank bailouts.",
      "Only 21 million bitcoins will ever exist — a hard cap written directly into the code.",
      "Bitcoin uses \"proof of work,\" where miners compete to solve puzzles using massive computing power to add new blocks.",
      "On \"Bitcoin Pizza Day\" (May 22, 2010), a programmer paid 10,000 BTC for two pizzas — a stash worth hundreds of millions of dollars today.",
      "Roughly every four years the mining reward is cut in half in an event called \"the halving,\" slowing the creation of new coins.",
      "Satoshi's untouched wallet is estimated to hold around 1.1 million BTC, making the anonymous creator one of the richest entities on Earth.",
      "The first person to receive a Bitcoin transaction was cryptographer Hal Finney, who got 10 BTC from Satoshi in January 2009.",
    ],
  },
  ETH: {
    intro:
      "Ethereum is a blockchain that works like a giant world computer — instead of just sending money, it runs \"smart contracts,\" self-executing programs that power apps, games, NFTs, and decentralized finance. Its native coin is called Ether (ETH).",
    facts: [
      "Ethereum was proposed in 2013 by Vitalik Buterin when he was just 19 years old, and launched in 2015.",
      "Buterin has said he was inspired to create Ethereum partly after a video game company nerfed his favorite World of Warcraft character.",
      "In 2022, Ethereum switched from proof of work to proof of stake in an event called \"The Merge,\" cutting its energy use by about 99.95%.",
      "Ethereum introduced smart contracts — code that runs automatically when conditions are met, with no middleman needed.",
      "Ethereum's 2014 crowdsale raised 31,000 BTC (about $18 million) from the public, at an average sale price of roughly $0.30 per ETH.",
      "Ethereum is the birthplace of NFTs, DeFi, and most stablecoins — many of which later spread to other blockchains.",
      "\"Gas\" is the fee you pay to use Ethereum, priced according to how much computing your transaction requires.",
      "Ethereum had several co-founders including Gavin Wood, who wrote the technical \"Yellow Paper\" and helped create its Solidity programming language.",
    ],
  },
  BNB: {
    intro:
      "BNB is the token of Binance, one of the world's largest crypto exchanges, and started as a way to get discounts on trading fees. Today it also powers the BNB Chain, a fast blockchain for apps and DeFi.",
    facts: [
      "BNB launched in July 2017 through an ICO that sold tokens for about 15 cents each and raised roughly $15 million.",
      "BNB now stands for \"Build and Build\" after a 2022 rebrand — it originally meant \"Binance Coin.\"",
      "Binance regularly \"burns\" (permanently destroys) BNB, aiming to shrink the supply from 200 million down to 100 million.",
      "BNB started life as a token on Ethereum before migrating to Binance's own blockchain in 2019.",
      "BNB Chain uses \"Proof of Staked Authority,\" a system with a limited set of vetted validators built for speed.",
      "BNB's burns are automated through \"Auto-Burn,\" adjusting the amount based on price and network activity each quarter.",
    ],
  },
  XRP: {
    intro:
      "XRP is a cryptocurrency built for fast, cheap money transfers across borders, designed to move value between currencies in seconds. It's closely tied to the company Ripple and settles transactions in 3–5 seconds for a tiny fraction of a cent.",
    facts: [
      "All 100 billion XRP were created at once in 2012 — none are \"mined\" like Bitcoin.",
      "XRP doesn't use mining or staking; instead trusted validators reach agreement in a unique consensus process, settling payments in 3–5 seconds.",
      "An early software bug wiped out the first 32,569 ledgers, so XRP's verifiable public history begins at ledger 32,570.",
      "XRP was designed as a \"bridge currency\" to help banks move money between different national currencies.",
      "In 2017 Ripple locked 55 billion XRP into escrow, releasing up to 1 billion per month to reassure the market about supply.",
      "The SEC sued Ripple in December 2020; a landmark 2023 ruling found XRP itself is not a security when sold to the public.",
      "XRP uses almost no energy — a single transaction is often compared to the energy of one Google search.",
      "Ripple's founders gifted 80 billion XRP (80% of the supply) to the company to fund development.",
    ],
  },
  SOL: {
    intro:
      "Solana is a super-fast blockchain built for speed and low fees, capable of handling thousands of transactions per second. It's a popular home for NFTs, DeFi, and meme coins, and its coin is called SOL.",
    facts: [
      "Solana was dreamed up by Anatoly Yakovenko, a former Qualcomm engineer, who wrote its founding whitepaper in 2017.",
      "It's named after Solana Beach, a small town near San Diego where the founders lived and surfed while working at Qualcomm.",
      "Solana's signature innovation, \"Proof of History,\" timestamps transactions to help the network order them at high speed.",
      "The project was originally called \"Loom\" but rebranded to avoid confusion with another crypto project.",
      "Solana has suffered several notable network outages, at one point going offline for about 17 hours in September 2021.",
      "Solana pairs proof of stake with Proof of History and can process thousands of transactions per second at very low fees.",
      "SOL crashed hard after the 2022 collapse of the FTX exchange, a major backer — then staged a huge recovery.",
      "A second independent software client called \"Firedancer\" was built to make the network more reliable after its outage-plagued years.",
    ],
  },
  TRX: {
    intro:
      "TRON is a blockchain focused on cheap, fast transactions and digital content, founded by entrepreneur Justin Sun in 2017. Today it's one of the biggest networks in the world for moving stablecoins like USDT.",
    facts: [
      "TRON was founded in 2017 by Justin Sun, a charismatic entrepreneur once named to Forbes' 30 Under 30.",
      "TRON acquired the file-sharing pioneer BitTorrent in 2018, bringing millions of users into its ecosystem.",
      "TRON uses \"Delegated Proof of Stake,\" where holders vote for 27 \"Super Representatives\" who validate transactions.",
      "TRON hosts the largest share of the stablecoin Tether (USDT) of any blockchain — tens of billions of dollars' worth.",
      "TRON transactions are extremely cheap, often costing about a cent, making it popular for global remittances.",
      "The smallest unit of TRX is called a \"sun,\" named after founder Justin Sun.",
      "TRON started as a token on Ethereum before launching its own blockchain in 2018 — celebrated with a symbolic \"Independence Day\" burn of 1 billion TRX.",
      "Critics note TRON is relatively centralized, with just 27 block-producing validators and heavy influence from Justin Sun.",
    ],
  },
  HYPE: {
    intro:
      "Hyperliquid is a newer blockchain (launched 2024) built specifically for fast, on-chain trading of crypto \"perpetual\" futures, rivaling big centralized exchanges. Its token, HYPE, powers the network and made headlines for one of the largest airdrops in crypto history.",
    facts: [
      "Hyperliquid gave away its HYPE token on November 29, 2024 — 310 million HYPE (31% of the 1 billion supply) sent to about 94,000 wallets in one of the largest airdrops ever.",
      "The project famously took no venture capital money, allocating the vast majority of its tokens to the community instead.",
      "Hyperliquid was founded by Jeff Yan, a Harvard graduate and former Hudson River Trading quant, with a small team.",
      "Its blockchain runs on a custom consensus called \"HyperBFT\" and claims to process hundreds of thousands of orders per second.",
      "Unlike centralized exchanges, Hyperliquid keeps its entire order book fully on-chain and transparent.",
      "HYPE has a fixed maximum supply of 1 billion tokens, and the protocol uses most of its trading fees to buy back and burn HYPE.",
      "The airdrop was so generous the average recipient's allocation was worth $45,000–$50,000 at the time.",
    ],
  },
  DOGE: {
    intro:
      "Dogecoin started in 2013 as a joke based on the \"Doge\" Shiba Inu meme, but grew into one of the most famous cryptocurrencies in the world. It's known for its friendly community, tiny transaction fees, and celebrity fans like Elon Musk.",
    facts: [
      "Dogecoin was created in 2013 by engineers Billy Markus and Jackson Palmer as a parody of the crypto craze.",
      "Its logo is Kabosu, a real Japanese Shiba Inu adopted from a shelter, made famous by the \"Doge\" meme.",
      "Co-founder Billy Markus sold all his Dogecoin in 2015 to buy a used Honda Civic — a stash worth millions at later peaks.",
      "Dogecoin's community once raised funds to sponsor a NASCAR driver and send the Jamaican bobsled team to the 2014 Olympics.",
      "Unlike Bitcoin, Dogecoin has no supply cap — about 5 billion new coins are created every year.",
      "Dogecoin uses proof of work but with fast one-minute blocks, making it quick and cheap for tipping online.",
      "SpaceX agreed to launch a satellite called \"DOGE-1\" to the Moon, funded entirely with Dogecoin.",
    ],
  },
  LINK: {
    intro:
      "Chainlink is a network that acts as a bridge between blockchains and the real world, feeding smart contracts reliable outside data like prices, weather, and sports scores. Its token, LINK, pays the operators who deliver that data.",
    facts: [
      "Chainlink solves the \"oracle problem\" — blockchains can't reach outside data on their own, so Chainlink securely delivers it.",
      "It was co-founded in 2017 by Sergey Nazarov and Steve Ellis, with a whitepaper co-authored by Cornell professor Ari Juels.",
      "Chainlink raised exactly $32 million in its 2017 ICO at an average price near $0.09 per LINK.",
      "Instead of trusting one source, Chainlink gathers data from many independent nodes and cross-checks it for accuracy.",
      "Node operators must stake LINK as collateral and can be penalized for supplying bad data.",
      "Chainlink has enabled trillions of dollars in transaction value and secures a large majority of the DeFi oracle market.",
      "Banking giant SWIFT has tested Chainlink's cross-chain technology for moving tokenized assets between systems.",
      "LINK has a fixed maximum supply of 1 billion tokens.",
    ],
  },
  HBAR: {
    intro:
      "Hedera is a fast, energy-efficient network for building apps and moving value — but it's not technically a blockchain, using a different design called \"hashgraph.\" It's governed by a council of major global companies, and its coin is called HBAR.",
    facts: [
      "Hedera uses \"hashgraph\" instead of a blockchain — data forms a web (a directed graph) rather than a single chain of blocks.",
      "The hashgraph algorithm was invented by Dr. Leemon Baird, who co-founded Hedera with Mance Harmon; both worked at the U.S. Air Force Academy.",
      "Hedera is run by a \"Governing Council\" of major companies — members have included Google, IBM, LG, and Deutsche Telekom — each with one equal vote.",
      "The council's one-company-one-vote structure was modeled on Visa's original 1968 governance framework.",
      "Hedera reaches agreement using \"gossip about gossip\" and \"virtual voting,\" and is asynchronous Byzantine Fault Tolerant (aBFT).",
      "Transactions cost about $0.0001 and the network is carbon-negative, buying offsets that more than cover its tiny energy use.",
      "All 50 billion HBAR were created at the network's 2018 launch — the supply is capped and can't grow without a unanimous council vote.",
      "In 2024 Hedera donated its entire codebase to the Linux Foundation (as a project called \"Hiero\") — reportedly the first public network to do so.",
      "Hedera's hashgraph technology was patented, then later open-sourced under the Apache 2.0 license in 2022.",
    ],
  },
};
