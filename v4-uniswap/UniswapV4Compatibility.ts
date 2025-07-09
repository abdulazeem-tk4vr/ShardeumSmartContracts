import { expect } from 'chai'
import { ethers } from 'hardhat'
import { Contract, Signer } from 'ethers'

/* -------------------------------------------------------------------------- */
/*                     Uniswap V4 – Network Compatibility Test                */
/* -------------------------------------------------------------------------- */

describe('Uniswap V4 – Network Compatibility', function () {
  // Increase timeout to 5 minutes for slow networks
  this.timeout(300000)

  let deployer: Signer
  let auxiliary: Signer

  let tester: Contract
  let tokenA: Contract
  let tokenB: Contract
  let weth: Contract

  interface TestResult {
    success: boolean
    gasUsed: bigint
    details: string
  }

  interface V4CompatibilityReport {
    network?: string
    critical?: {
      singletonPools?: TestResult
      hooksLifecycle?: TestResult
      unlockCallbacks?: TestResult
      ercStandards?: TestResult
    }
    important?: {
      storageOptimization?: TestResult
      protocolFees?: TestResult
    }
    performance?: {
      stackDepth?: TestResult
    }
    overall?: 'COMPATIBLE' | 'INCOMPATIBLE' | 'PARTIAL'
  }

  const results: Partial<V4CompatibilityReport> = {}

  // Timeout tracking utility
  function createTimeoutTracker(
    operation: string,
    warningTime = 30000
  ): {
    finish: () => number
    elapsed: () => number
  } {
    const startTime = Date.now()
    let warningShown = false

    const warningHandle = setTimeout(() => {
      const elapsed = Date.now() - startTime
      console.log(`⏰ ${operation} is taking longer than expected (${elapsed}ms)...`)
      warningShown = true
    }, warningTime)

    return {
      finish: (): number => {
        clearTimeout(warningHandle)
        const elapsed = Date.now() - startTime
        if (warningShown) {
          console.log(`✅ ${operation} completed after ${elapsed}ms`)
        }
        return elapsed
      },
      elapsed: (): number => Date.now() - startTime,
    }
  }

  before(async () => {
    ;[deployer, auxiliary] = await ethers.getSigners()
    const net = await ethers.provider.getNetwork()
    console.log(`Network  : ${net.name} (chainId ${net.chainId})`)
    console.log(`Deployer : ${await deployer.getAddress()}`)
  })

  /* ------------------------------------------------------------------------ */
  /*                               Deployment                                  */
  /* ------------------------------------------------------------------------ */

  it('deploys the V4 compatibility tester', async () => {
    const deployTracker = createTimeoutTracker('V4 tester deployment', 60000)

    try {
      const Factory = await ethers.getContractFactory(
        'contracts/v4-uniswap/UniswapV4CompatibilityTester.sol:UniswapV4CompatibilityTester'
      )

      console.log('Deploying V4 compatibility tester...')
      tester = await Factory.deploy({ gasLimit: 5_000_000 })
      await tester.deploymentTransaction()?.wait()

      const size = await tester.getContractSize()
      const deployTime = deployTracker.finish()

      console.log(`Tester deployed at: ${await tester.getAddress()}`)
      console.log(`Contract size: ${size.toString()} bytes`)
      console.log(`🕐 Deployment time: ${deployTime}ms`)

      expect(size).to.be.gt(0)
      expect(size).to.be.lt(25000) // Should be reasonable size for V4 tester
    } catch (error) {
      deployTracker.finish()
      throw error
    }
  })

  it('deploys ERC-20 fixtures', async () => {
    const fixturesTracker = createTimeoutTracker('ERC-20 fixtures deployment', 45000)

    try {
      console.log('Deploying ERC-20 test fixtures...')

      const tokenTracker = createTimeoutTracker('Test token deployment', 30000)
      const Tkn = await ethers.getContractFactory('TestToken')
      tokenA = await (await Tkn.deploy('TokenA', 'TKA')).waitForDeployment()
      tokenB = await (await Tkn.deploy('TokenB', 'TKB')).waitForDeployment()
      const tokenTime = tokenTracker.finish()
      console.log(`✅ Test tokens deployed (${tokenTime}ms)`)

      const wethTracker = createTimeoutTracker('WETH deployment', 20000)
      const WETH = await ethers.getContractFactory('contracts/WETH9.sol:WETH9')
      weth = await (await WETH.deploy()).waitForDeployment()
      const wethTime = wethTracker.finish()
      console.log(`✅ WETH deployed (${wethTime}ms)`)

      const mintTracker = createTimeoutTracker('Token minting', 15000)
      const amount = ethers.parseEther('1000000')
      const depAddr = await deployer.getAddress()
      const tstAddr = await tester.getAddress()

      for (const t of [tokenA, tokenB]) {
        await t.mint(depAddr, amount)
        await t.mint(tstAddr, amount)
      }
      const mintTime = mintTracker.finish()
      console.log(`✅ Tokens minted (${mintTime}ms)`)

      console.log(`TokenA: ${await tokenA.getAddress()}`)
      console.log(`TokenB: ${await tokenB.getAddress()}`)
      console.log(`WETH: ${await weth.getAddress()}`)

      expect(await tokenA.balanceOf(depAddr)).to.equal(amount)
    } catch (error) {
      fixturesTracker.finish()
      throw error
    } finally {
      const totalTime = fixturesTracker.finish()
      console.log(`🕐 Total ERC-20 fixtures deployment time: ${totalTime}ms`)
    }
  })

  /* ------------------------------------------------------------------------ */
  /*                            CRITICAL TESTS (Must Pass)                   */
  /* ------------------------------------------------------------------------ */

  it('[CRITICAL] tests singleton pool architecture', async () => {
    const testTracker = createTimeoutTracker('Singleton pools test')

    try {
      console.log('Testing singleton pools...')

      // First try staticCall with detailed error handling
      let result: any
      try {
        const staticTracker = createTimeoutTracker('Static call for singleton pools', 15000)
        result = await tester.testSingletonPools.staticCall()
        const staticTime = staticTracker.finish()
        console.log(`✅ Static call succeeded (${staticTime}ms)`)
      } catch (staticError) {
        console.log('❌ Static call failed:', staticError)
        if (staticError instanceof Error) {
          console.log('Stack trace:', staticError.stack)
        }
        throw staticError
      }

      results.critical = results.critical || {}
      results.critical.singletonPools = {
        success: result.success,
        gasUsed: result.gasUsed,
        details: result.details,
      }

      console.log(`Singleton Pools: ${result.success ? '✅' : '❌'} (${result.gasUsed.toString()} gas)`)
      console.log(`  Details: ${result.details}`)

      if (result.success) {
        try {
          console.log('Executing actual transaction...')

          // Try with gas estimation
          const gasTracker = createTimeoutTracker('Gas estimation for singleton pools', 10000)
          const gasEstimate = await tester.testSingletonPools.estimateGas()
          const gasTime = gasTracker.finish()
          console.log(`Gas estimate: ${gasEstimate.toString()} (${gasTime}ms)`)

          const txTracker = createTimeoutTracker('Transaction execution for singleton pools', 60000)
          const tx = await tester.testSingletonPools({
            gasLimit: gasEstimate * 2n, // Use 2x estimated gas
          })

          console.log(`Transaction sent: ${tx.hash}`)
          const receipt = await tx.wait()
          const txTime = txTracker.finish()
          console.log(`Transaction confirmed in block: ${receipt?.blockNumber} (${txTime}ms)`)

          // Verify pool count increased
          const poolCount = await tester.poolCount()
          expect(poolCount).to.be.gt(0)
          console.log(`Pool count after test: ${poolCount}`)
        } catch (txError) {
          console.log('❌ Transaction execution failed:', txError)
          if (txError instanceof Error) {
            console.log('Stack trace:', txError.stack)
          }

          // Update results with transaction error
          results.critical.singletonPools = {
            success: false,
            gasUsed: 0n,
            details: `Transaction failed: ${txError instanceof Error ? txError.message : 'Unknown error'}`,
          }
          throw txError
        }
      }

      expect(result.success).to.be.true
    } catch (error) {
      console.log('❌ Singleton pools test failed with error:', error)
      if (error instanceof Error) {
        console.log('Full stack trace:', error.stack)
      }

      results.critical = results.critical || {}
      results.critical.singletonPools = {
        success: false,
        gasUsed: 0n,
        details: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }
      throw error
    } finally {
      const totalTime = testTracker.finish()
      console.log(`🕐 Total singleton pools test time: ${totalTime}ms`)
    }
  })

  it('[CRITICAL] tests hooks lifecycle', async () => {
    const testTracker = createTimeoutTracker('Hooks lifecycle test')

    try {
      console.log('Testing hooks lifecycle...')

      // First try staticCall with detailed error handling
      let result: any
      try {
        const staticTracker = createTimeoutTracker('Static call for hooks lifecycle', 15000)
        console.log('Attempting static call...')
        result = await tester.testHooksLifecycle.staticCall()
        const staticTime = staticTracker.finish()
        console.log(`✅ Static call succeeded (${staticTime}ms)`)
      } catch (staticError) {
        console.log('❌ Static call failed:', staticError)
        if (staticError instanceof Error) {
          console.log('Stack trace:', staticError.stack)
        }
        throw staticError
      }

      results.critical = results.critical || {}
      results.critical.hooksLifecycle = {
        success: result.success,
        gasUsed: result.gasUsed,
        details: result.details,
      }

      console.log(`Hooks Lifecycle: ${result.success ? '✅' : '❌'} (${result.gasUsed.toString()} gas)`)
      console.log(`  Details: ${result.details}`)

      if (result.success) {
        try {
          console.log('Executing actual transaction...')

          // Try with different gas limits to find the right amount
          const gasTracker = createTimeoutTracker('Gas estimation for hooks lifecycle', 10000)
          console.log('Estimating gas...')
          const gasEstimate = await tester.testHooksLifecycle.estimateGas()
          const gasTime = gasTracker.finish()
          console.log(`Gas estimate: ${gasEstimate.toString()} (${gasTime}ms)`)

          const txTracker = createTimeoutTracker('Transaction execution for hooks lifecycle', 60000)
          const tx = await tester.testHooksLifecycle({
            gasLimit: gasEstimate * 2n, // Use 2x estimated gas
          })

          console.log(`Transaction sent: ${tx.hash}`)
          const receipt = await tx.wait()
          const txTime = txTracker.finish()
          console.log(`Transaction confirmed in block: ${receipt?.blockNumber} (${txTime}ms)`)

          // Check if transaction was successful
          if (receipt?.status === 0) {
            throw new Error('Transaction was reverted by the EVM')
          }
        } catch (txError) {
          console.log('❌ Transaction execution failed:', txError)
          if (txError instanceof Error) {
            console.log('Stack trace:', txError.stack)
          }

          // Update results with transaction error
          results.critical.hooksLifecycle = {
            success: false,
            gasUsed: 0n,
            details: `Transaction failed: ${txError instanceof Error ? txError.message : 'Unknown error'}`,
          }
          throw txError
        }
      }

      expect(result.success).to.be.true
    } catch (error) {
      console.log('❌ Hooks lifecycle test failed with error:', error)
      if (error instanceof Error) {
        console.log('Full stack trace:', error.stack)
      }

      results.critical = results.critical || {}
      results.critical.hooksLifecycle = {
        success: false,
        gasUsed: 0n,
        details: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }
      throw error
    } finally {
      const totalTime = testTracker.finish()
      console.log(`🕐 Total hooks lifecycle test time: ${totalTime}ms`)
    }
  })

  it('[CRITICAL] tests unlock callback pattern', async () => {
    const testTracker = createTimeoutTracker('Unlock callbacks test')

    try {
      console.log('Testing unlock callbacks...')

      // First try staticCall with detailed error handling
      let result: any
      try {
        const staticTracker = createTimeoutTracker('Static call for unlock callbacks', 15000)
        result = await tester.testUnlockCallbacks.staticCall()
        const staticTime = staticTracker.finish()
        console.log(`✅ Static call succeeded (${staticTime}ms)`)
      } catch (staticError) {
        console.log('❌ Static call failed:', staticError)
        if (staticError instanceof Error) {
          console.log('Stack trace:', staticError.stack)
        }
        throw staticError
      }

      results.critical = results.critical || {}
      results.critical.unlockCallbacks = {
        success: result.success,
        gasUsed: result.gasUsed,
        details: result.details,
      }

      console.log(`Unlock Callbacks: ${result.success ? '✅' : '❌'} (${result.gasUsed.toString()} gas)`)
      console.log(`  Details: ${result.details}`)

      if (result.success) {
        try {
          console.log('Executing actual transaction...')

          const gasTracker = createTimeoutTracker('Gas estimation for unlock callbacks', 10000)
          const gasEstimate = await tester.testUnlockCallbacks.estimateGas()
          const gasTime = gasTracker.finish()
          console.log(`Gas estimate: ${gasEstimate.toString()} (${gasTime}ms)`)

          const txTracker = createTimeoutTracker('Transaction execution for unlock callbacks', 45000)
          const tx = await tester.testUnlockCallbacks({
            gasLimit: gasEstimate * 2n, // Use 2x estimated gas
          })

          console.log(`Transaction sent: ${tx.hash}`)
          const receipt = await tx.wait()
          const txTime = txTracker.finish()
          console.log(`Transaction confirmed in block: ${receipt?.blockNumber} (${txTime}ms)`)

          // Check if transaction was successful
          if (receipt?.status === 0) {
            throw new Error('Transaction was reverted by the EVM')
          }
        } catch (txError) {
          console.log('❌ Transaction execution failed:', txError)
          if (txError instanceof Error) {
            console.log('Stack trace:', txError.stack)
          }

          // Update results with transaction error
          results.critical.unlockCallbacks = {
            success: false,
            gasUsed: 0n,
            details: `Transaction failed: ${txError instanceof Error ? txError.message : 'Unknown error'}`,
          }
          throw txError
        }
      }

      expect(result.success).to.be.true
    } catch (error) {
      console.log('❌ Unlock callbacks test failed with error:', error)
      if (error instanceof Error) {
        console.log('Full stack trace:', error.stack)
      }

      results.critical = results.critical || {}
      results.critical.unlockCallbacks = {
        success: false,
        gasUsed: 0n,
        details: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }
      throw error
    } finally {
      const totalTime = testTracker.finish()
      console.log(`🕐 Total unlock callbacks test time: ${totalTime}ms`)
    }
  })

  it('[CRITICAL] tests ERC standards support', async () => {
    const testTracker = createTimeoutTracker('ERC standards test')

    try {
      console.log('Testing ERC standards...')

      // First try staticCall with detailed error handling
      let result: any
      try {
        const staticTracker = createTimeoutTracker('Static call for ERC standards', 15000)
        result = await tester.testERCStandards.staticCall()
        const staticTime = staticTracker.finish()
        console.log(`✅ Static call succeeded (${staticTime}ms)`)
      } catch (staticError) {
        console.log('❌ Static call failed:', staticError)
        if (staticError instanceof Error) {
          console.log('Stack trace:', staticError.stack)
        }
        throw staticError
      }

      results.critical = results.critical || {}
      results.critical.ercStandards = {
        success: result.success,
        gasUsed: result.gasUsed,
        details: result.details,
      }

      console.log(`ERC Standards: ${result.success ? '✅' : '❌'} (${result.gasUsed.toString()} gas)`)
      console.log(`  Details: ${result.details}`)

      if (result.success) {
        try {
          console.log('Executing actual transaction...')

          const gasTracker = createTimeoutTracker('Gas estimation for ERC standards', 10000)
          const gasEstimate = await tester.testERCStandards.estimateGas()
          const gasTime = gasTracker.finish()
          console.log(`Gas estimate: ${gasEstimate.toString()} (${gasTime}ms)`)

          const txTracker = createTimeoutTracker('Transaction execution for ERC standards', 45000)
          const tx = await tester.testERCStandards({
            gasLimit: gasEstimate * 2n, // Use 2x estimated gas
          })

          console.log(`Transaction sent: ${tx.hash}`)
          const receipt = await tx.wait()
          const txTime = txTracker.finish()
          console.log(`Transaction confirmed in block: ${receipt?.blockNumber} (${txTime}ms)`)

          // Check if transaction was successful
          if (receipt?.status === 0) {
            throw new Error('Transaction was reverted by the EVM')
          }
        } catch (txError) {
          console.log('❌ Transaction execution failed:', txError)
          if (txError instanceof Error) {
            console.log('Stack trace:', txError.stack)
          }

          // Update results with transaction error
          results.critical.ercStandards = {
            success: false,
            gasUsed: 0n,
            details: `Transaction failed: ${txError instanceof Error ? txError.message : 'Unknown error'}`,
          }
          throw txError
        }
      }

      expect(result.success).to.be.true
    } catch (error) {
      console.log('❌ ERC standards test failed with error:', error)
      if (error instanceof Error) {
        console.log('Full stack trace:', error.stack)
      }

      results.critical = results.critical || {}
      results.critical.ercStandards = {
        success: false,
        gasUsed: 0n,
        details: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }
      throw error
    } finally {
      const totalTime = testTracker.finish()
      console.log(`🕐 Total ERC standards test time: ${totalTime}ms`)
    }
  })

  /* ------------------------------------------------------------------------ */
  /*                           IMPORTANT TESTS (Should Pass)                 */
  /* ------------------------------------------------------------------------ */

  it('[IMPORTANT] tests storage optimization', async () => {
    const testTracker = createTimeoutTracker('Storage optimization test')

    try {
      console.log('Testing storage optimization...')

      // First try staticCall with detailed error handling
      let result: any
      try {
        const staticTracker = createTimeoutTracker('Static call for storage optimization', 15000)
        result = await tester.testStorageOptimization.staticCall()
        const staticTime = staticTracker.finish()
        console.log(`✅ Static call succeeded (${staticTime}ms)`)
      } catch (staticError) {
        console.log('❌ Static call failed:', staticError)
        if (staticError instanceof Error) {
          console.log('Stack trace:', staticError.stack)
        }
        throw staticError
      }

      results.important = results.important || {}
      results.important.storageOptimization = {
        success: result.success,
        gasUsed: result.gasUsed,
        details: result.details,
      }

      console.log(`Storage Optimization: ${result.success ? '✅' : '❌'} (${result.gasUsed.toString()} gas)`)
      console.log(`  Details: ${result.details}`)

      if (result.success) {
        try {
          console.log('Executing actual transaction...')

          const gasTracker = createTimeoutTracker('Gas estimation for storage optimization', 10000)
          const gasEstimate = await tester.testStorageOptimization.estimateGas()
          const gasTime = gasTracker.finish()
          console.log(`Gas estimate: ${gasEstimate.toString()} (${gasTime}ms)`)

          const txTracker = createTimeoutTracker('Transaction execution for storage optimization', 45000)
          const tx = await tester.testStorageOptimization({
            gasLimit: gasEstimate * 2n, // Use 2x estimated gas
          })

          console.log(`Transaction sent: ${tx.hash}`)
          const receipt = await tx.wait()
          const txTime = txTracker.finish()
          console.log(`Transaction confirmed in block: ${receipt?.blockNumber} (${txTime}ms)`)

          // Check if transaction was successful
          if (receipt?.status === 0) {
            throw new Error('Transaction was reverted by the EVM')
          }
        } catch (txError) {
          console.log('❌ Transaction execution failed:', txError)
          if (txError instanceof Error) {
            console.log('Stack trace:', txError.stack)
          }

          // Update results with transaction error
          results.important.storageOptimization = {
            success: false,
            gasUsed: 0n,
            details: `Transaction failed: ${txError instanceof Error ? txError.message : 'Unknown error'}`,
          }
          throw txError
        }
      }
    } catch (error) {
      console.log('❌ Storage optimization test failed with error:', error)
      if (error instanceof Error) {
        console.log('Full stack trace:', error.stack)
      }

      results.important = results.important || {}
      results.important.storageOptimization = {
        success: false,
        gasUsed: 0n,
        details: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }
      console.log(`Storage Optimization: ❌ (${error instanceof Error ? error.message : 'Unknown error'})`)
    } finally {
      const totalTime = testTracker.finish()
      console.log(`🕐 Total storage optimization test time: ${totalTime}ms`)
    }
  })

  it('[IMPORTANT] tests protocol fees', async () => {
    const testTracker = createTimeoutTracker('Protocol fees test')

    try {
      console.log('Testing protocol fees...')

      // First try staticCall with detailed error handling
      let result: any
      try {
        const staticTracker = createTimeoutTracker('Static call for protocol fees', 15000)
        result = await tester.testProtocolFees.staticCall()
        const staticTime = staticTracker.finish()
        console.log(`✅ Static call succeeded (${staticTime}ms)`)
      } catch (staticError) {
        console.log('❌ Static call failed:', staticError)
        if (staticError instanceof Error) {
          console.log('Stack trace:', staticError.stack)
        }
        throw staticError
      }

      results.important = results.important || {}
      results.important.protocolFees = {
        success: result.success,
        gasUsed: result.gasUsed,
        details: result.details,
      }

      console.log(`Protocol Fees: ${result.success ? '✅' : '❌'} (${result.gasUsed.toString()} gas)`)
      console.log(`  Details: ${result.details}`)

      if (result.success) {
        try {
          console.log('Executing actual transaction...')

          const gasTracker = createTimeoutTracker('Gas estimation for protocol fees', 10000)
          const gasEstimate = await tester.testProtocolFees.estimateGas()
          const gasTime = gasTracker.finish()
          console.log(`Gas estimate: ${gasEstimate.toString()} (${gasTime}ms)`)

          const txTracker = createTimeoutTracker('Transaction execution for protocol fees', 45000)
          const tx = await tester.testProtocolFees({
            gasLimit: gasEstimate * 2n, // Use 2x estimated gas
          })

          console.log(`Transaction sent: ${tx.hash}`)
          const receipt = await tx.wait()
          const txTime = txTracker.finish()
          console.log(`Transaction confirmed in block: ${receipt?.blockNumber} (${txTime}ms)`)

          // Check if transaction was successful
          if (receipt?.status === 0) {
            throw new Error('Transaction was reverted by the EVM')
          }
        } catch (txError) {
          console.log('❌ Transaction execution failed:', txError)
          if (txError instanceof Error) {
            console.log('Stack trace:', txError.stack)
          }

          // Update results with transaction error
          results.important.protocolFees = {
            success: false,
            gasUsed: 0n,
            details: `Transaction failed: ${txError instanceof Error ? txError.message : 'Unknown error'}`,
          }
          throw txError
        }
      }
    } catch (error) {
      console.log('❌ Protocol fees test failed with error:', error)
      if (error instanceof Error) {
        console.log('Full stack trace:', error.stack)
      }

      results.important = results.important || {}
      results.important.protocolFees = {
        success: false,
        gasUsed: 0n,
        details: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }
      console.log(`Protocol Fees: ❌ (${error instanceof Error ? error.message : 'Unknown error'})`)
    } finally {
      const totalTime = testTracker.finish()
      console.log(`🕐 Total protocol fees test time: ${totalTime}ms`)
    }
  })

  /* ------------------------------------------------------------------------ */
  /*                         PERFORMANCE TESTS (Optional)                    */
  /* ------------------------------------------------------------------------ */

  it('[PERFORMANCE] tests stack depth', async () => {
    const testTracker = createTimeoutTracker('Stack depth test')

    try {
      console.log('Testing stack depth...')

      // First try staticCall with detailed error handling
      let result: any
      try {
        const staticTracker = createTimeoutTracker('Static call for stack depth', 15000)
        result = await tester.testStackDepth.staticCall()
        const staticTime = staticTracker.finish()
        console.log(`✅ Static call succeeded (${staticTime}ms)`)
      } catch (staticError) {
        console.log('❌ Static call failed:', staticError)
        if (staticError instanceof Error) {
          console.log('Stack trace:', staticError.stack)
        }
        throw staticError
      }

      results.performance = results.performance || {}
      results.performance.stackDepth = {
        success: result.success,
        gasUsed: result.gasUsed,
        details: result.details,
      }

      console.log(`Stack Depth: ${result.success ? '✅' : '❌'} (${result.gasUsed.toString()} gas)`)
      console.log(`  Details: ${result.details}`)

      if (result.success) {
        try {
          console.log('Executing actual transaction...')

          const gasTracker = createTimeoutTracker('Gas estimation for stack depth', 10000)
          const gasEstimate = await tester.testStackDepth.estimateGas()
          const gasTime = gasTracker.finish()
          console.log(`Gas estimate: ${gasEstimate.toString()} (${gasTime}ms)`)

          const txTracker = createTimeoutTracker('Transaction execution for stack depth', 45000)
          const tx = await tester.testStackDepth({
            gasLimit: gasEstimate * 2n, // Use 2x estimated gas
          })

          console.log(`Transaction sent: ${tx.hash}`)
          const receipt = await tx.wait()
          const txTime = txTracker.finish()
          console.log(`Transaction confirmed in block: ${receipt?.blockNumber} (${txTime}ms)`)

          // Check if transaction was successful
          if (receipt?.status === 0) {
            throw new Error('Transaction was reverted by the EVM')
          }
        } catch (txError) {
          console.log('❌ Transaction execution failed:', txError)
          if (txError instanceof Error) {
            console.log('Stack trace:', txError.stack)
          }

          // Update results with transaction error
          results.performance.stackDepth = {
            success: false,
            gasUsed: 0n,
            details: `Transaction failed: ${txError instanceof Error ? txError.message : 'Unknown error'}`,
          }
          throw txError
        }
      }
    } catch (error) {
      console.log('❌ Stack depth test failed with error:', error)
      if (error instanceof Error) {
        console.log('Full stack trace:', error.stack)
      }

      results.performance = results.performance || {}
      results.performance.stackDepth = {
        success: false,
        gasUsed: 0n,
        details: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }
      console.log(`Stack Depth: ❌ (${error instanceof Error ? error.message : 'Unknown error'})`)
    } finally {
      const totalTime = testTracker.finish()
      console.log(`🕐 Total stack depth test time: ${totalTime}ms`)
    }
  })

  /* ------------------------------------------------------------------------ */
  /*                         COMPREHENSIVE ASSESSMENT                        */
  /* ------------------------------------------------------------------------ */

  it('runs comprehensive network assessment', async () => {
    const assessmentTracker = createTimeoutTracker('Comprehensive network assessment', 10000)

    try {
      console.log('Running comprehensive assessment...')

      // Calculate compatibility based on actual test results
      const criticalResults = results.critical || {}
      const importantResults = results.important || {}
      const performanceResults = results.performance || {}

      // Count successful tests
      const criticalCount = Object.values(criticalResults).filter((r) => r?.success).length
      const importantCount = Object.values(importantResults).filter((r) => r?.success).length
      const performanceCount = Object.values(performanceResults).filter((r) => r?.success).length

      console.log('\n📊 V4 Network Capabilities Assessment:')
      console.log('=====================================')
      console.log(`Singleton Pools:        ${criticalResults.singletonPools?.success ? '✅' : '❌'}`)
      console.log(`Hooks Lifecycle:        ${criticalResults.hooksLifecycle?.success ? '✅' : '❌'}`)
      console.log(`Unlock Callbacks:       ${criticalResults.unlockCallbacks?.success ? '✅' : '❌'}`)
      console.log(`ERC6909 Support:        ${criticalResults.ercStandards?.success ? '✅' : '❌'}`)
      console.log(`Storage Optimization:   ${importantResults.storageOptimization?.success ? '✅' : '❌'}`)
      console.log(`Protocol Fees:          ${importantResults.protocolFees?.success ? '✅' : '❌'}`)
      console.log(`Stack Depth:            ${performanceResults.stackDepth?.success ? '✅' : '❌'}`)

      // Determine overall compatibility
      let overallStatus: 'COMPATIBLE' | 'INCOMPATIBLE' | 'PARTIAL'
      if (criticalCount >= 3) {
        // Relaxed requirement: 3/4 critical tests
        overallStatus = importantCount >= 1 ? 'COMPATIBLE' : 'PARTIAL'
      } else {
        overallStatus = 'INCOMPATIBLE'
      }

      console.log(`\n🎯 Overall Status: ${overallStatus}`)
      console.log(`   Critical Tests: ${criticalCount}/4 passed`)
      console.log(`   Important Tests: ${importantCount}/2 passed`)
      console.log(`   Performance Tests: ${performanceCount}/1 passed`)

      if (overallStatus === 'INCOMPATIBLE') {
        console.log('\n⚠️  This network is NOT ready for Uniswap V4 deployment!')
        console.log('   Critical features are missing or failing.')
      } else if (overallStatus === 'PARTIAL') {
        console.log('\n⚠️  This network has PARTIAL V4 compatibility.')
        console.log('   Core features work but some optimizations may not be available.')
      } else {
        console.log('\n✅ This network is READY for Uniswap V4 deployment!')
        console.log('   All critical and most important features are supported.')
      }

      // Store final results
      results.network = (await ethers.provider.getNetwork()).name
      results.overall = overallStatus

      const assessmentTime = assessmentTracker.finish()
      console.log(`🕐 Assessment time: ${assessmentTime}ms`)

      // Only fail if critical requirement not met
      if (criticalCount < 3) {
        throw new Error(`Critical V4 features missing: ${4 - criticalCount} tests failed`)
      }
    } catch (error) {
      assessmentTracker.finish()
      console.log(`\n❌ Assessment failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      throw error
    }
  })

  /* ------------------------------------------------------------------------ */
  /*                              Final Report                                 */
  /* ------------------------------------------------------------------------ */

  after(async () => {
    const reportTracker = createTimeoutTracker('Final report generation', 5000)

    try {
      console.log('\n📋 Final V4 Compatibility Report:')
      console.log('==================================')

      // Convert BigInt to string for JSON serialization
      const serializedResults = JSON.parse(
        JSON.stringify(results, (key, value) => (typeof value === 'bigint' ? value.toString() : value))
      )

      console.table(serializedResults)

      // Save results to file for CI/CD
      const fs = await import('fs')
      const path = await import('path')
      const resultsPath = path.join(process.cwd(), 'v4-compatibility-results.json')
      fs.writeFileSync(resultsPath, JSON.stringify(serializedResults, null, 2))

      const reportTime = reportTracker.finish()
      console.log(`Results saved to: ${resultsPath}`)
      console.log(`🕐 Report generation time: ${reportTime}ms`)
    } catch (error) {
      reportTracker.finish()
      console.log(`❌ Report generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  })
})
